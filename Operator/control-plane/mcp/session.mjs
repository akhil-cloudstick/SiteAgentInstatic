// Headless sign-in to a tenant CMS, reusing the ONE hub login.
//
// There is no second login anywhere in the product, so the gateway does not
// invent one: it mints the same short-lived signed SSO token the hub already
// hands a browser (`signValue({ sub, target: 'instatic', kind: 'sso' })`,
// verified by the CMS in `server/auth/tenantSso.ts`), follows the 302, and
// keeps the session cookie the CMS sets. No CMS password is read or stored —
// `owner_password_enc` is never touched by this module.
//
// Requests go straight to the tenant's loopback port rather than through the
// public gateway, because the gateway proxy routes by hub session cookie and
// we have no browser session. Loopback also means the CMS marks the session
// cookie non-Secure, so it survives the plain-HTTP hop.
//
// CSRF: `originAllowed` in the CMS trusts a request with NO Origin header
// (server-to-server), so these calls deliberately send none.
import { signValue } from '../lib/crypto.mjs';
import { getTenant } from '../registry/tenants.mjs';

const SSO_TTL_SEC = 120;
// Re-mint well before the CMS session actually lapses; a 401 re-mints anyway.
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map(); // slug -> { cookie, mintedAt, port }

export function invalidateSession(slug) {
  sessions.delete(slug);
}

async function resolveTenant(slug) {
  const tenant = await getTenant(slug);
  if (!tenant) throw new Error(`Unknown tenant "${slug}"`);
  if (!tenant.port) throw new Error(`Tenant "${slug}" has no running port — start it first`);
  if (tenant.status === 'removed') throw new Error(`Tenant "${slug}" has been removed`);
  return tenant;
}

export function tenantOrigin(tenant) {
  return `http://127.0.0.1:${tenant.port}`;
}

// Exchange a fresh SSO token for a CMS session cookie.
async function mintSession(slug) {
  const tenant = await resolveTenant(slug);
  const token = signValue({ sub: slug, target: 'instatic', kind: 'sso' }, SSO_TTL_SEC);
  const url = `${tenantOrigin(tenant)}/cms/api/cms/sso?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { method: 'GET', redirect: 'manual' });
  // The SSO route answers 302 + Set-Cookie on success. Any other status means
  // the workspace is not set up, the secret drifted, or the token expired.
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const setCookie = raw.length ? raw : [res.headers.get('set-cookie')].filter(Boolean);
  if (!setCookie.length) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `SSO into "${slug}" failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  // Keep only the `name=value` pair; the attributes are for browsers.
  const cookie = setCookie.map((c) => String(c).split(';')[0]).join('; ');
  const entry = { cookie, mintedAt: Date.now(), port: tenant.port };
  sessions.set(slug, entry);
  return entry;
}

async function sessionFor(slug) {
  const cached = sessions.get(slug);
  if (cached && Date.now() - cached.mintedAt < SESSION_TTL_MS) return cached;
  return await mintSession(slug);
}

/**
 * Call a tenant CMS admin endpoint with an authenticated session, re-minting
 * once on 401 so an expired session is invisible to the caller.
 *
 * `body` may be a plain object (sent as JSON) or a FormData (sent as multipart
 * so `media_upload` reaches `readUploadedFileForCreate` byte-exactly).
 */
export async function tenantFetch(slug, path, { method = 'GET', body, headers } = {}, _retried = false) {
  const tenant = await resolveTenant(slug);
  const session = await sessionFor(slug);

  const init = { method, redirect: 'manual', headers: { cookie: session.cookie, ...(headers || {}) } };
  if (body instanceof FormData) {
    init.body = body; // undici sets the multipart boundary itself
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${tenantOrigin(tenant)}${path}`, init);

  if (res.status === 401 && !_retried) {
    invalidateSession(slug);
    return await tenantFetch(slug, path, { method, body, headers }, true);
  }
  return res;
}

/**
 * `tenantFetch` + envelope handling. Returns the parsed JSON body, or throws
 * with the CMS's own `{ error }` message so the agent sees the real reason
 * rather than a generic failure.
 */
export async function tenantJson(slug, path, options) {
  const res = await tenantFetch(slug, path, options);
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const message = parsed && parsed.error ? parsed.error : text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed === null ? {} : parsed;
}

/** Call one of the plugin's capability-gated internal routes. */
export function pluginCall(slug, routePath, body) {
  return tenantJson(slug, `/cms/api/cms/plugins/mms.mcp-bridge/runtime${routePath}`, {
    method: 'POST',
    body: body || {},
  });
}

/** True when the bridge plugin is installed and active on this tenant. */
export async function pluginInstalled(slug) {
  try {
    const res = await tenantFetch(slug, '/cms/api/cms/plugins/mms.mcp-bridge/runtime/health');
    return res.status === 200;
  } catch {
    return false;
  }
}
