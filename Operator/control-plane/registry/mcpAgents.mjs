// MCP agent keys + per-call audit rows.
//
// A key is minted here (Node crypto), handed to the operator ONCE in plaintext,
// and afterwards matched by keyed hash only. The tenant CMS never sees a key:
// the gateway authenticates into a tenant over hub SSO, so nothing agent-shaped
// is stored inside a tenant at all.
import { randomBytes, createHmac } from 'node:crypto';
import { query } from './db.mjs';
import { encrypt, decrypt } from '../lib/crypto.mjs';
import config from '../lib/env.mjs';

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
// plaintext exists outside the caller's clipboard.
export async function createAgentKey({ tenantSlug, label, permissions, tables, expiresInDays }) {
  const token = genAgentToken();
  const keyId = genKeyId();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + Number(expiresInDays) * 86400_000).toISOString()
    : null;
  const { rows } = await query(
    `insert into siteagent_control.mcp_agents
       (tenant_slug, key_id, label, token_hash, token_enc, permissions, tables, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [
      tenantSlug,
      keyId,
      label || 'agent',
      hashAgentToken(token),
      encrypt(token),
      permissions || [],
      tables && tables.length ? tables : ['*'],
      expiresAt,
    ],
  );
  return { ...toView(rows[0]), token };
}

export async function listAgentKeys(tenantSlug) {
  const { rows } = tenantSlug
    ? await query(
        `select * from siteagent_control.mcp_agents
          where tenant_slug = $1 order by created_at desc`,
        [tenantSlug],
      )
    : await query('select * from siteagent_control.mcp_agents order by created_at desc');
  return rows.map(toView);
}

// The console re-shows a key the operator already minted (same rationale as the
// tenant invite link). Revoked keys never reveal their token.
export async function revealAgentKey(keyId) {
  const { rows } = await query(
    'select token_enc, revoked_at from siteagent_control.mcp_agents where key_id = $1',
    [keyId],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  return decrypt(row.token_enc);
}

export async function revokeAgentKey(keyId) {
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

export async function listAgentAudit(tenantSlug, limit = 50) {
  const { rows } = await query(
    `select * from siteagent_control.mcp_agent_audit
      where tenant_slug = $1 order by created_at desc limit $2`,
    [tenantSlug, Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}

// Directory row per tenant for the console overview.
export async function agentKeyCounts() {
  const { rows } = await query(
    `select tenant_slug,
            count(*) filter (where revoked_at is null) as active,
            count(*) as total,
            max(last_used_at) as last_used
       from siteagent_control.mcp_agents
      group by tenant_slug`,
  );
  return rows;
}
