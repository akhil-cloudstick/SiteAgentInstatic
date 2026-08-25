// Tenant Hub — the tenant-facing surface of the control-plane.
//   /invite/:token  set a password (one-time), then land in the hub
//   /login          the ONE login a tenant uses for both tools
//   /hub            advanced -> two cards (OpenDesign + Instatic); lite -> straight to OpenDesign
//   /logout
// SSO into each tool is a short-lived signed token the tool validates (Phase 3/4).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';
import { getTenant } from '../registry/tenants.mjs';
import { validateLogin, acceptInvite, findByInviteToken } from '../registry/tenantUsers.mjs';
import { signValue, verifyValue } from '../lib/crypto.mjs';

const SESSION_COOKIE = 'sa_hub';
const SESSION_TTL_SEC = 7 * 24 * 3600;
const SSO_TTL_SEC = 120;

// The hub pages (/login, /hub, /invite) must show the SAME MMS mark as the CMS and
// the design studio — three different icons across one product reads as three
// different products. OpenDesign and Instatic ship byte-identical favicons, so we
// reuse that exact file rather than drawing our own.
//
// It is inlined as a data URI (read once at startup) instead of served from a
// route: a bare `/favicon.ico` request would fall through the gateway to the CMS
// catch-all rather than reaching the control plane.
const FAVICON_TAG = (() => {
  const candidates = [
    resolve(config.openDesignDir, 'apps', 'web', 'public', 'favicon-32x32.png'),
    resolve(config.instaticDir ?? '', 'public', 'favicon-32x32.png'),
  ];
  for (const file of candidates) {
    try {
      const b64 = readFileSync(file).toString('base64');
      return `<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${b64}">`;
    } catch { /* try the next candidate */ }
  }
  console.warn('[hub] MMS favicon not found; hub pages will show the browser default');
  return '';
})();

// ---- low-level helpers ---------------------------------------------------
function html(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function redirect(res, location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  // `cookie` may be an array — signing out expires one cookie per tool.
  if (cookie && (!Array.isArray(cookie) || cookie.length > 0)) headers['Set-Cookie'] = cookie;
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
// SameSite=None (not Lax) because this cookie now decides WHICH TENANT a request
// is routed to, and some of those requests come from OpenDesign's preview iframes.
// Those are sandboxed WITHOUT allow-same-origin, so the browser treats their
// requests as cross-site and withholds a Lax cookie — the gateway would then see
// no session and answer "not signed in" for every raw file in a preview.
// Requires Secure, which we have (the funnel is HTTPS). CSRF is still covered:
// the OD daemon validates Origin against OD_ALLOWED_ORIGINS, and state-changing
// hub routes are POST-only.
function sessionCookie(slug) {
  const val = signValue({ sub: slug, kind: 'hub' }, SESSION_TTL_SEC);
  return `${SESSION_COOKIE}=${val}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=${SESSION_TTL_SEC}`;
}
// One login means one logout. The hub cookie is only the OUTER session — each
// tool mints its own, longer-lived-than-you-think cookie during SSO, and
// clearing just `sa_hub` left the user still signed in to whichever tool they
// opened next: the hub bounced them to /login while /design and /cms happily
// served the previous tenant's session. Every one of these is set on the funnel
// origin, so the control plane can expire all three here.
//
// Deletion matches on name + domain + PATH, so each Path must mirror the one
// the cookie was set with — `instatic_admin_session` is scoped to /cms and a
// Path=/ clear would silently miss it.
function clearCookie() {
  return [
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=0`,
    // OpenDesign daemon session (apps/daemon/src/server.ts).
    'od_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
    // Instatic admin session (server/handlers/cms/session.ts).
    'instatic_admin_session=; HttpOnly; Path=/cms; SameSite=Lax; Secure; Max-Age=0',
  ];
}

// Where to send the user after a successful login. `next` comes from
// /login?next=… (set by the gateway when it bounces an unauthenticated page
// request). Only same-origin ABSOLUTE PATHS are accepted — never a full URL, and
// never `//host` — so this cannot be turned into an open redirect.
function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}
function currentSlug(req) {
  const p = verifyValue(parseCookies(req)[SESSION_COOKIE]);
  return p && p.kind === 'hub' ? p.sub : null;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The authorized scope carried across a hand-off, per the MMSBUILD shared-header
// contract: the specialist product renders it in its header row and returns to
// `hubReturnUrl` on "Back to Product Hub". The registry is infrastructure-only
// today (slug, ports, tier — no client or project record), so we send the scope
// we actually hold. The CMS treats every absent field as absent rather than
// substituting a default, so partial scope degrades cleanly.
function hubContextParams(tenant, origin) {
  const params = new URLSearchParams();
  params.set('hubRole', 'operator');
  params.set('hubSite', tenant.slug);
  params.set('hubOrigin', origin);
  params.set('hubReturnUrl', `${config.gatewayOrigin}/hub`);
  return params.toString();
}

// Short-lived signed SSO hand-off URL for a tool. The tool validates the token
// (server-side) and mints its own session — see Phase 3 (OD) / Phase 4 (Instatic).
export function ssoUrl(tenant, target) {
  const token = signValue({ sub: tenant.slug, target, kind: 'sso' }, SSO_TTL_SEC);
  // All hand-offs go through the public gateway origin (funnel :443), not the
  // tenant's localhost port, so the URLs work for a remote client.
  if (target === 'instatic') {
    // Root path -> the gateway's session-routed catch-all forwards it to THIS
    // tenant's Instatic (the request carries the sa_hub cookie set at login).
    return `${config.gatewayOrigin}/cms/api/cms/sso?token=${encodeURIComponent(token)}`
      + `&${hubContextParams(tenant, 'hub')}`;
  }
  // OpenDesign: the tenant-agnostic /od mount. The gateway splits /od/sso off to
  // THIS tenant's daemon using the sa_hub cookie set at login — exactly like the
  // Instatic hand-off above. No slug in the URL: one shared Next build serves
  // every tenant (see docs/opendesign-shared-web-build.md).
  return `${config.gatewayOrigin}/design/sso?token=${encodeURIComponent(token)}`;
}

// ---- page templates ------------------------------------------------------
function shell(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · MMS Design</title>
${FAVICON_TAG}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;500;600;700;800&display=swap">
<style>
  /* MMS Design System — cream canvas, navy ink, Approval-Green CTA. */
  :root{--bg:#f8f1df;--card:#ffffff;--line:rgba(8,42,56,.16);--text:#082a38;--muted:#44515a;--accent:#1ba957;--accent-strong:#0e8c45}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.55 'Nunito Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:24px}
  .wrap{width:100%;max-width:560px}
  h1{font-family:'Nunito','Nunito Sans',sans-serif;font-weight:800;font-size:24px;margin:0 0 4px} .muted{color:var(--muted)}
  form{margin-top:18px} label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}
  input{width:100%;padding:10px 12px;background:#fff;border:1px solid var(--line);
    border-radius:8px;color:var(--text);font:inherit}
  input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(27,169,87,.18)}
  button{margin-top:18px;width:100%;padding:12px;background:var(--accent);color:#fff;border:0;
    border-radius:999px;font-size:15px;font-weight:800;cursor:pointer;transition:background .12s,filter .12s}
  button:hover{background:var(--accent-strong)}
  .err{background:#fdeae6;color:#8a2a1a;border:1px solid #f5c7bf;border-radius:8px;padding:10px;margin-top:14px;font-size:14px}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
  @media(max-width:520px){.cards{grid-template-columns:1fr}}
  .card{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);
    border-radius:14px;padding:22px;box-shadow:0 6px 24px rgba(8,42,56,.08),0 2px 6px rgba(8,42,56,.05);transition:border-color .15s,transform .15s,box-shadow .15s}
  .card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 22px 48px rgba(8,42,56,.16)}
  .card .ico{font-size:30px} .card h3{font-family:'Nunito','Nunito Sans',sans-serif;margin:10px 0 4px;font-size:17px;font-weight:800}
  .topbar{display:flex;justify-content:space-between;align-items:center}
  .logout{font-size:13px;color:var(--muted);text-decoration:none}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

function loginPage(err, next) {
  return shell('Sign in', `
    <h1>Sign in</h1>
    <p class="muted">One login for your design studio and CMS.</p>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    ${next ? '<p class="muted">Your session expired — sign in to pick up where you left off.</p>' : ''}
    <form method="POST" action="/login">
      ${next ? `<input type="hidden" name="next" value="${esc(next)}" />` : ''}
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
    <!-- The cards link to the hand-off ROUTES, not to a pre-minted token URL.
         SSO tokens live 120 seconds and these hrefs are stamped when this page
         renders, so a hub tab left open for three minutes used to hand the tool
         an expired token — and the OpenDesign daemon answers that with a hard
         401 rather than bouncing back here. /sso/<tool> mints on click, so the
         token is always seconds old however long the page has been sitting. -->
    <div class="cards">
      <a class="card" href="/sso/design">
        <div class="ico">&#127912;</div><h3>MMS Design</h3>
        <div class="muted">Design your website visually. Push it to your CMS when ready.</div>
      </a>
      <a class="card" href="/sso/cms">
        <div class="ico">&#128441;&#65039;</div><h3>MMS CMS</h3>
        <div class="muted">Edit content, publish, and manage your live site.</div>
      </a>
    </div>`);
}

// ---- router --------------------------------------------------------------
// Returns true if it handled the request.
export async function handleHub(req, res, method, path) {
  // GET /sso/<tool>?next=<path> — SILENT RE-SSO. This is what makes "one login"
  // hold in production. A tool session (Instatic's admin cookie, OD's od_session)
  // is shorter-lived than the hub session and is missing entirely when a user
  // arrives by bookmark or in a fresh browser profile. Without this route each
  // tool falls back to ITS OWN login form — which is the second login we never
  // want to see. Instead both tools redirect here, and:
  //   • hub session valid  -> mint a fresh SSO token, hand off, land on `next`.
  //     The user sees a redirect, never a form.
  //   • hub session absent -> /login once, then straight back through here.
  // Tools only fall back to their own login when they are NOT hub-managed
  // (standalone installs), which is exactly the right behaviour.
  const ssoRoute = path.match(/^\/sso\/(design|cms)$/);
  if (ssoRoute && method === 'GET') {
    const tool = ssoRoute[1];
    const next = safeNext(new URL(req.url, 'http://x').searchParams.get('next'));
    const slug = currentSlug(req);
    if (!slug) {
      // Come back here after signing in, so the hand-off still happens.
      const back = `/sso/${tool}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
      redirect(res, `/login?next=${encodeURIComponent(back)}`);
      return true;
    }
    const tenant = await getTenant(slug);
    if (!tenant) { redirect(res, '/login'); return true; }
    const target = tool === 'cms' ? 'instatic' : 'od';
    let url = ssoUrl(tenant, target);
    if (next) url += `&redirect=${encodeURIComponent(next)}`;
    redirect(res, url);
    return true;
  }


  // GET /login[?next=/design/...] — carry `next` through the form so a session
  // that expired mid-edit returns the user to the page they were on.
  if (path === '/login' && method === 'GET') {
    const next = safeNext(new URL(req.url, 'http://x').searchParams.get('next'));
    html(res, 200, loginPage(null, next));
    return true;
  }

  // POST /login
  if (path === '/login' && method === 'POST') {
    const f = await readForm(req);
    const next = safeNext(f.next);
    const slug = await validateLogin(f.identifier, f.password);
    if (!slug) { html(res, 401, loginPage('Wrong email/account or password.', next)); return true; }
    // Back to where they were. If they signed in as a DIFFERENT tenant the deep
    // link is not theirs to open, so drop them at that tool's home instead of a
    // 404: /design/... -> /design, anything else -> /hub.
    let target = '/hub';
    if (next) {
      const sameTenant = currentSlug(req) === null || currentSlug(req) === slug;
      target = sameTenant ? next : (next.startsWith('/design') ? '/design' : '/hub');
    }
    redirect(res, target, sessionCookie(slug));
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
