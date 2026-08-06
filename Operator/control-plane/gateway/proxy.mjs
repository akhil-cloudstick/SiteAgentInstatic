// Reverse-proxy the single public funnel origin to the right per-tenant backend,
// so the operator + every tenant's OpenDesign + Instatic all live behind ONE URL.
//
//   /operator/*    -> the Astro operator console (open access, no login).
//
//   /design/*      -> the ONE shared OpenDesign web build, path preserved (its
//                     Next basePath is a fixed `/design`). Daemon-owned paths under
//                     it (/design/api, /design/sso, /design/artifacts, /design/frames) are split
//                     off to the CURRENT hub session's own OD daemon.
//                     The slug is deliberately NOT in the path: basePath is a
//                     build-time constant, so `/od/<slug>` forced one Next build
//                     and one `next start` per tenant, which does not scale.
//                     Tenant isolation is unchanged — each tenant still has its
//                     own daemon + data dir; only the UI shell is shared.
//
//   everything the -> the CURRENT hub session's tenant Instatic (root preserved).
//   control-plane     Instatic serves published pages at arbitrary ROOT slugs
//   did not claim     (`/about`) plus `/cms`, `/assets`, `/uploads`, all
//                     root-absolute and baked by Vite. Prefixing that would fight
//                     Instatic's root-only design, so instead we multiplex tenants
//                     by the signed `sa_hub` cookie — ONE tenant per browser.
//
// Node built-ins only (http), mirroring the rest of the control-plane.
import http from 'node:http';
import config from '../lib/env.mjs';
import { getTenant } from '../registry/tenants.mjs';
import { verifyValue } from '../lib/crypto.mjs';
import * as odRuntime from '../runtime/odRuntime.mjs';

const HUB_COOKIE = 'sa_hub';
// Fixed, tenant-agnostic mount point for the ONE shared OpenDesign web build.
// It must match the Next basePath in odRuntime.buildWeb()/startSharedWeb().
const OD_PREFIX = '/design';

// Resolve the tenant slug from the signed hub session cookie (same cookie
// hub.mjs issues on login). Returns null when there is no valid session.
function sessionSlug(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== HUB_COOKIE) continue;
    const payload = verifyValue(decodeURIComponent(part.slice(eq + 1).trim()));
    return payload && payload.kind === 'hub' ? payload.sub : null;
  }
  return null;
}

// A backend served behind a path prefix (OpenDesign under /design) may issue a
// ROOT-relative redirect — e.g. the OD daemon's SSO handler does `res.redirect('/')`
// and Next.js proxies that Location through untouched. Left as-is it lands on the
// gateway root; rewrite it to live under the prefix so the browser stays in the app.
function rewriteLocation(headers, prefix) {
  const loc = headers.location;
  if (!prefix || typeof loc !== 'string' || !loc.startsWith('/') || loc.startsWith('//') || loc.startsWith(prefix)) {
    return headers;
  }
  return { ...headers, location: prefix + loc };
}

// The OpenDesign SPA emits ABSOLUTE URLs (/api, /artifacts, /frames, /sso, public
// assets) with no basePath — Next.js only prefixes its own <Link> and _next
// assets, not raw fetch/EventSource/<img>/<iframe>/css url(). The client-side
// shim (apps/web/app/gateway-basepath-shim.ts) patches most of those, but any it
// misses arrive base-less at the gateway root. They all carry a Referer of the OD
// page that issued them, so we can recognise them and restore the prefix here.
// The TENANT is never taken from the Referer — it comes from the session cookie,
// so a forged Referer cannot reach another tenant's daemon.
function isFromOdPage(req) {
  const ref = req.headers.referer || req.headers.referrer;
  if (!ref) return false;
  try {
    const p = new URL(ref).pathname;
    return p === OD_PREFIX || p.startsWith(`${OD_PREFIX}/`);
  } catch {
    return false;
  }
}

// No usable session on a request that needs one. A top-level navigation gets a
// 302 to /login carrying where it was headed, so signing in lands the user back
// on the exact page (mid-edit deep links included) instead of dumping them on the
// hub. Sub-resource requests (fetch/XHR/iframe) cannot follow a login redirect
// usefully, so they get a plain 401 for the app to handle.
function unauthenticated(req, path) {
  const isDocument = req.headers['sec-fetch-dest'] === 'document'
    || (!req.headers['sec-fetch-dest'] && (req.headers.accept || '').includes('text/html'));
  if (!isDocument) return { status: 401, body: 'not signed in' };
  return { redirect: `/login?next=${encodeURIComponent(req.url || path)}` };
}

// Paths owned by the OD DAEMON (not the Next web): its HTTP API, SSO entry, and
// artifact/frame static serving. The Next web only proxies these to the daemon in
// DEV mode — a pre-built (production) web does NOT — so the gateway must send them
// straight to the daemon itself, which works identically in dev and pre-built mode.
function isDaemonPath(p) {
  return p === '/api' || p.startsWith('/api/')
    || p === '/sso' || p.startsWith('/sso?') || p.startsWith('/sso/')
    || p.startsWith('/artifacts/') || p.startsWith('/frames/');
}

// Forward a Node req/res pair to a 127.0.0.1 backend, streaming both ways.
// The backend binds localhost, so we present a local Host but forward the real
// scheme/host so it can build correct absolute URLs and set Secure cookies.
// `rewritePath` overrides the upstream path (used to restore the OD basePath).
function forward(req, res, target) {
  const { port, prefix, rewritePath } = target;
  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${port}`;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-for'] = req.socket?.remoteAddress || '';

  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: rewritePath || req.url, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, rewriteLocation(up.headers, prefix));
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`gateway: upstream unavailable (${err.code || err.message})`);
  });
  req.pipe(upstream);
}

// Pick the backend port for a request, or null if the control-plane should
// handle it (login/hub/operator/api) or 404 it. Shared by HTTP + upgrade paths.
async function resolveBackend(req, path) {
  // Operator console (Astro, served with base=/operator). No auth — open access.
  if (path === '/operator' || path.startsWith('/operator/')) {
    return { port: config.operatorConsolePort, kind: 'operator' };
  }
  // Explicit /design/... — ONE shared web build serves every tenant, so the slug
  // is NOT in the path any more. Daemon-owned paths (/api,/sso,/artifacts,/frames)
  // go STRAIGHT to the SESSION's own daemon with the prefix stripped (works in dev
  // AND pre-built, unlike Next's dev-only proxy); everything else (SPA + _next
  // assets + public) goes to the single shared Next web, path preserved because
  // that build's basePath IS this prefix.
  //
  // This is the same multiplexing Instatic already uses below: the tenant comes
  // from the signed `sa_hub` cookie, ONE tenant per browser. It is also the data
  // isolation boundary — a request can only ever reach the daemon of the tenant
  // whose session cookie it carries.
  if (path === OD_PREFIX || path.startsWith(`${OD_PREFIX}/`)) {
    const restPath = path.slice(OD_PREFIX.length) || '/';
    if (isDaemonPath(restPath)) {
      const slug = sessionSlug(req);
      // No (or expired) session. For a top-level page load, bounce to /login and
      // come back afterwards — never dead-end on a bare error string. For a
      // sub-resource (fetch/XHR/iframe) a redirect would be useless, so answer
      // 401 and let the app react.
      if (!slug) return unauthenticated(req, path);
      const t = await getTenant(slug);
      if (!t?.od_port) return { notFound: 'unknown OpenDesign tenant' };
      return {
        port: t.od_port,
        kind: 'od-daemon',
        prefix: OD_PREFIX,
        rewritePath: req.url.slice(OD_PREFIX.length) || '/',
      };
    }
    return { port: odRuntime.sharedWebPort(), kind: 'od', prefix: OD_PREFIX };
  }
  // Base-less SUB-RESOURCE request FROM an OD page (an absolute /api, /artifacts
  // or asset URL that escaped the client-side basePath shim). Recognise it by the
  // Referer and restore the `/design` prefix. Exclude top-level document navigations
  // (Sec-Fetch-Dest: document) — clicking from OD back to /hub or /login must
  // still reach the control-plane, not get pushed to OD.
  if (isFromOdPage(req) && req.headers['sec-fetch-dest'] !== 'document') {
    if (isDaemonPath(path)) {
      const slug = sessionSlug(req);
      if (slug) {
        const t = await getTenant(slug);
        if (t?.od_port) return { port: t.od_port, kind: 'od-daemon', prefix: OD_PREFIX, rewritePath: req.url };
      }
    } else {
      return {
        port: odRuntime.sharedWebPort(),
        kind: 'od',
        prefix: OD_PREFIX,
        rewritePath: `${OD_PREFIX}${req.url}`,
      };
    }
  }
  const slug = sessionSlug(req);
  if (slug) {
    const t = await getTenant(slug);
    if (t?.port) return { port: t.port, kind: 'instatic' };
  }
  return null;
}

// HTTP proxy. Returns true if it handled (proxied) the request; false lets the
// control-plane fall through to its own routes / 404 / login bounce.
export async function handleGatewayProxy(req, res, method, path) {
  const target = await resolveBackend(req, path);
  if (!target) return false;
  if (target.redirect) {
    res.writeHead(302, { location: target.redirect, 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (target.status) {
    res.writeHead(target.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(target.body ?? '');
    return true;
  }
  if (target.notFound) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(target.notFound);
    return true;
  }
  forward(req, res, target);
  return true;
}

// WebSocket / upgrade passthrough (Next.js dev HMR, live editor bridges). Wired
// via server.on('upgrade'). Best-effort: on any failure the socket is closed.
export async function handleGatewayUpgrade(req, socket, head) {
  const path = new URL(req.url, 'http://x').pathname;
  let target;
  try { target = await resolveBackend(req, path); } catch { target = null; }
  // A redirect/401 verdict is meaningless for a socket upgrade — just refuse it.
  if (!target || target.notFound || target.redirect || target.status) { socket.destroy(); return; }

  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${target.port}`;
  const upstream = http.request({
    host: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers,
  });
  upstream.on('upgrade', (upRes, upSocket) => {
    const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      for (const val of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${val}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upSocket.unshift(head);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    upSocket.on('error', () => socket.destroy());
    socket.on('error', () => upSocket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}
