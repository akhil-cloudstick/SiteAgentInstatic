// MCP agent keys + per-call audit rows.
//
// A key is minted here (Node crypto), handed to the operator ONCE in plaintext,
// and afterwards matched by keyed hash only. The tenant CMS never sees a key:
// the gateway authenticates into a tenant over hub SSO, so nothing agent-shaped
// is stored inside a tenant at all.
import { randomBytes, createHmac } from 'node:crypto';
import { query } from './db.mjs';
import config from '../lib/env.mjs';
import { scopeFilter, canReachRecord } from '../lib/scope.mjs';

// Keyed hash for an inbound bearer. Namespaced separately from invite tokens
// (`invite:`) so the two token families can never be cross-matched.
export const hashAgentToken = (token) =>
  createHmac('sha256', config.tokenSecret).update(`mcp:${token}`).digest('hex');

const genKeyId = () => `mk_${randomBytes(9).toString('base64url')}`;
const genAgentToken = () => `mmsmcp_${randomBytes(32).toString('base64url')}`;

function toView(row) {
  if (!row) return null;
  return {
    keyId: row.key_id,
    tenantSlug: row.tenant_slug,
    label: row.label,
    permissions: row.permissions || [],
    tables: row.tables || ['*'],
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

// Mint a key. Returns the view PLUS the raw token — the only moment the
// plaintext exists outside the caller's clipboard. Only the keyed hash is
// stored (NEW-1): there is no way to read a key back after this.
export async function createAgentKey({ tenantSlug, label, permissions, tables, expiresInDays }) {
  const token = genAgentToken();
  const keyId = genKeyId();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + Number(expiresInDays) * 86400_000).toISOString()
    : null;
  const { rows } = await query(
    `insert into siteagent_control.mcp_agents
       (tenant_slug, key_id, label, token_hash, token_enc, permissions, tables, expires_at)
     values ($1,$2,$3,$4, null, $5,$6,$7)
     returning *`,
    [
      tenantSlug,
      keyId,
      label || 'agent',
      hashAgentToken(token),
      permissions || [],
      tables && tables.length ? tables : ['*'],
      expiresAt,
    ],
  );
  return { ...toView(rows[0]), token };
}

// Every read names the administrator's scope (R1): keys are stamped with
// their project's address, so the filter is on the key row itself.
export async function listAgentKeys(scope, tenantSlug) {
  const f = scopeFilter(scope, 'a', tenantSlug ? [tenantSlug] : []);
  const { rows } = await query(
    `select a.* from siteagent_control.mcp_agents a
      where ${tenantSlug ? 'a.tenant_slug = $1 and ' : ''}${f.sql}
      order by a.created_at desc`,
    f.params,
  );
  return rows.map(toView);
}

export async function revokeAgentKey(scope, keyId) {
  const { rows: found } = await query(
    'select business_id, operator_id from siteagent_control.mcp_agents where key_id = $1',
    [keyId],
  );
  // A key in another Business is indistinguishable from no key.
  if (!found[0] || !canReachRecord(scope, found[0])) return null;
  const { rows } = await query(
    `update siteagent_control.mcp_agents
        set revoked_at = now(), token_enc = null
      where key_id = $1 and revoked_at is null
      returning *`,
    [keyId],
  );
  return toView(rows[0]);
}

// Resolve an inbound bearer to its profile. Returns null for unknown, revoked,
// or expired keys — the caller cannot tell which, by design.
export async function findAgentKeyByToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `select * from siteagent_control.mcp_agents
      where token_hash = $1 and revoked_at is null
        and (expires_at is null or expires_at > now())`,
    [hashAgentToken(token)],
  );
  return toView(rows[0]);
}

// Fire-and-forget: a slow or failing stamp must never delay a tool call.
export function touchAgentKey(keyId) {
  query('update siteagent_control.mcp_agents set last_used_at = now() where key_id = $1', [keyId])
    .catch((e) => console.error('[mcp] last_used stamp failed:', e.message));
}

export function recordAgentCall({ tenantSlug, keyId, tool, target, ok, error }) {
  query(
    `insert into siteagent_control.mcp_agent_audit (tenant_slug, key_id, tool, target, ok, error)
     values ($1,$2,$3,$4,$5,$6)`,
    [tenantSlug, keyId || null, tool, target || null, !!ok, error ? String(error).slice(0, 500) : null],
  ).catch((e) => console.error('[mcp] audit write failed:', e.message));
}

export async function listAgentAudit(scope, tenantSlug, limit = 50) {
  const f = scopeFilter(scope, 'e', [tenantSlug, Math.min(Number(limit) || 50, 200)]);
  const { rows } = await query(
    `select e.* from siteagent_control.mcp_agent_audit e
      where e.tenant_slug = $1 and ${f.sql}
      order by e.created_at desc limit $2`,
    f.params,
  );
  return rows;
}

// Directory row per tenant for the console overview.
export async function agentKeyCounts(scope) {
  const f = scopeFilter(scope, 'a');
  const { rows } = await query(
    `select a.tenant_slug,
            count(*) filter (where a.revoked_at is null) as active,
            count(*) as total,
            max(a.last_used_at) as last_used
       from siteagent_control.mcp_agents a
      where ${f.sql}
      group by a.tenant_slug`,
    f.params,
  );
  return rows;
}
