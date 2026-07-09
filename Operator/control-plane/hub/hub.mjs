// Tenant Hub — the tenant-facing surface of the control-plane.
//   /invite/:token  set a password (one-time), then land in the hub
//   /login          the ONE login a tenant uses for both tools
//   /hub            advanced -> two cards (OpenDesign + Instatic); lite -> straight to OpenDesign
//   /logout
// SSO into each tool is a short-lived signed token the tool validates (Phase 3/4).
import config from '../lib/env.mjs';
import { getTenant } from '../registry/tenants.mjs';
import { validateLogin, acceptInvite, findByInviteToken } from '../registry/tenantUsers.mjs';
import { signValue, verifyValue } from '../lib/crypto.mjs';

const SESSION_COOKIE = 'sa_hub';
const SESSION_TTL_SEC = 7 * 24 * 3600;
const SSO_TTL_SEC = 120;

// ---- low-level helpers ---------------------------------------------------
function html(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function redirect(res, location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}
function readForm(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100_000) req.destroy(); });
    req.on('end', () => {
      const out = {};
      new URLSearchParams(data).forEach((v, k) => { out[k] = v; });
      resolve(out);
    });
    req.on('error', () => resolve({}));
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function sessionCookie(slug) {
  const val = signValue({ sub: slug, kind: 'hub' }, SESSION_TTL_SEC);
  return `${SESSION_COOKIE}=${val}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}
function clearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
function currentSlug(req) {
  const p = verifyValue(parseCookies(req)[SESSION_COOKIE]);
  return p && p.kind === 'hub' ? p.sub : null;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Short-lived signed SSO hand-off URL for a tool. The tool validates the token
// (server-side) and mints its own session — see Phase 3 (OD) / Phase 4 (Instatic).
export function ssoUrl(tenant, target) {
  const token = signValue({ sub: tenant.slug, target, kind: 'sso' }, SSO_TTL_SEC);
  if (target === 'instatic') return `http://127.0.0.1:${tenant.port}/admin/sso?token=${encodeURIComponent(token)}`;
  return `http://127.0.0.1:${tenant.od_port}/sso?token=${encodeURIComponent(token)}`; // od
}

// ---- page templates ------------------------------------------------------
function shell(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#0e0f12;--card:#16181d;--line:#262a31;--text:#e8eaed;--muted:#9aa0aa;--accent:#5b8def}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:24px}
  .wrap{width:100%;max-width:560px}
  h1{font-size:22px;margin:0 0 4px} .muted{color:var(--muted)}
  form{margin-top:18px} label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}
  input{width:100%;padding:10px 12px;background:#0b0c0f;border:1px solid var(--line);
    border-radius:8px;color:var(--text);font-size:15px}
  button{margin-top:18px;width:100%;padding:11px;background:var(--accent);color:#fff;border:0;
    border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  .err{background:#3a1a1a;color:#f0a0a0;border:1px solid #5a2a2a;border-radius:8px;padding:10px;margin-top:14px;font-size:14px}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
  @media(max-width:520px){.cards{grid-template-columns:1fr}}
  .card{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);
    border-radius:14px;padding:22px;transition:border-color .15s,transform .15s}
  .card:hover{border-color:var(--accent);transform:translateY(-2px)}
  .card .ico{font-size:30px} .card h3{margin:10px 0 4px;font-size:17px}
  .topbar{display:flex;justify-content:space-between;align-items:center}
  .logout{font-size:13px;color:var(--muted);text-decoration:none}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

function loginPage(err) {
  return shell('Sign in', `
    <h1>Sign in</h1>
    <p class="muted">One login for your design studio and CMS.</p>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <form method="POST" action="/login">
      <label>Email or account</label>
      <input name="identifier" autocomplete="username" autofocus required />
      <label>Password</label>
      <input name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>`);
}

function invitePage(token, err) {
  return shell('Set your password', `
    <h1>Welcome — set your password</h1>
    <p class="muted">This becomes your single login for both tools.</p>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <form method="POST" action="/invite/${encodeURIComponent(token)}">
      <label>New password (min 8 characters)</label>
      <input name="password" type="password" autocomplete="new-password" autofocus required minlength="8" />
      <label>Confirm password</label>
      <input name="confirm" type="password" autocomplete="new-password" required minlength="8" />
      <button type="submit">Set password &amp; continue</button>
    </form>`);
}

function hubPage(tenant) {
  const name = esc(tenant.display_name || tenant.slug);
  return shell(`${name} — Home`, `
    <div class="topbar">
      <div><h1>Welcome, ${name}</h1><p class="muted">Choose where to work.</p></div>
      <form method="POST" action="/logout" style="margin:0"><button class="logout" style="background:none;border:0;padding:0;width:auto;margin:0" type="submit">Sign out</button></form>
    </div>
    <div class="cards">
      <a class="card" href="${esc(ssoUrl(tenant, 'od'))}">
        <div class="ico">&#127912;</div><h3>MMS Design</h3>
        <div class="muted">Design your website visually. Push it to your CMS when ready.</div>
      </a>
      <a class="card" href="${esc(ssoUrl(tenant, 'instatic'))}">
        <div class="ico">&#128441;&#65039;</div><h3>MMS CMS</h3>
        <div class="muted">Edit content, publish, and manage your live site.</div>
      </a>
    </div>`);
}

// ---- router --------------------------------------------------------------
// Returns true if it handled the request.
export async function handleHub(req, res, method, path) {
  // GET /login
  if (path === '/login' && method === 'GET') { html(res, 200, loginPage()); return true; }

  // POST /login
  if (path === '/login' && method === 'POST') {
    const f = await readForm(req);
    const slug = await validateLogin(f.identifier, f.password);
    if (!slug) { html(res, 401, loginPage('Wrong email/account or password.')); return true; }
    redirect(res, '/hub', sessionCookie(slug));
    return true;
  }

  // GET /invite/:token  and  POST /invite/:token
  const inv = path.match(/^\/invite\/([^/]+)$/);
  if (inv) {
    const token = decodeURIComponent(inv[1]);
    if (method === 'GET') {
      const user = await findByInviteToken(token);
      if (!user) { html(res, 410, shell('Invite', '<h1>Invite invalid or expired</h1><p class="muted">Ask your operator for a new link.</p>')); return true; }
      html(res, 200, invitePage(token));
      return true;
    }
    if (method === 'POST') {
      const f = await readForm(req);
      if (!f.password || f.password.length < 8) { html(res, 400, invitePage(token, 'Password must be at least 8 characters.')); return true; }
      if (f.password !== f.confirm) { html(res, 400, invitePage(token, 'Passwords do not match.')); return true; }
      const slug = await acceptInvite(token, f.password);
      if (!slug) { html(res, 410, invitePage(token, 'This invite is no longer valid.')); return true; }
      redirect(res, '/hub', sessionCookie(slug));
      return true;
    }
  }

  // POST /logout
  if (path === '/logout' && method === 'POST') { redirect(res, '/login', clearCookie()); return true; }

  // GET /hub  (requires session)
  if (path === '/hub' && method === 'GET') {
    const slug = currentSlug(req);
    if (!slug) { redirect(res, '/login'); return true; }
    const tenant = await getTenant(slug);
    if (!tenant) { redirect(res, '/login', clearCookie()); return true; }
    // Lite = OpenDesign only → straight in. Advanced = two cards.
    if ((tenant.tier || 'advanced') === 'lite') { redirect(res, ssoUrl(tenant, 'od')); return true; }
    html(res, 200, hubPage(tenant));
    return true;
  }

  return false;
}
