// Reverse-proxy the single public funnel origin to the right per-tenant backend,
// so the operator + every tenant's OpenDesign + Instatic all live behind ONE URL.
//
//   /operator/*    -> the Astro operator console (open access, no login).
//
//   /od/<slug>/*   -> that tenant's OpenDesign web (od_web_port), path preserved.
//                     The Next.js app runs with basePath=/od/<slug>, so it already
//                     emits its own assets/links/rewrites under the prefix. Because
//                     the slug is in the path, MANY tenants' OD can be open at once.
//
//   everything the -> the CURRENT hub session's tenant Instatic (root preserved).
//   control-plane     Instatic serves published pages at arbitrary ROOT slugs
//   did not claim     (`/about`) plus `/admin`, `/assets`, `/uploads`, all
//                     root-absolute and baked by Vite. Prefixing that would fight
//                     Instatic's root-only design, so instead we multiplex tenants
//                     by the signed `sa_hub` cookie — ONE tenant per browser.
//
// Node built-ins only (http), mirroring the rest of the control-plane.
import http from 'node:http';
import config from '../lib/env.mjs';
import { getTenant } from '../registry/tenants.mjs';
import { verifyValue } from '../lib/crypto.mjs';

const HUB_COOKIE = 'sa_hub';

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

// A backend served behind a path prefix (OpenDesign under /od/<slug>) may issue a
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
// assets) with no /od/<slug> basePath — Next.js only prefixes its own <Link> and
// _next assets, not raw fetch/EventSource/<img>/<iframe>/css url(). Those requests
// arrive base-less at the gateway root. But every one carries a Referer of the OD
// page that issued it, so we can recover the tenant + restore the prefix here —
// covering ALL request types at once, with zero app-side patching.
function odSlugFromReferer(req) {
  const ref = req.headers.referer || req.headers.referrer;
  if (!ref) return null;
  try {
    const m = new URL(ref).pathname.match(/^\/od\/([a-z0-9-]+)(?=\/|$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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
  // Explicit /od/<slug>/... — daemon-owned paths (/api,/sso,/artifacts,/frames) go
  // STRAIGHT to the daemon with the prefix stripped (works in dev AND pre-built,
  // unlike Next's dev-only proxy); everything else (SPA + _next assets + public)
  // goes to the Next web.
  const od = path.match(/^\/od\/([a-z0-9-]+)(?:\/|$)/);
  if (od) {
    const slug = od[1];
    const prefix = `/od/${slug}`;
    const t = await getTenant(slug);
    if (!t?.od_web_port) return { notFound: 'unknown OpenDesign tenant' };
    const restPath = path.slice(prefix.length) || '/';
    if (t.od_port && isDaemonPath(restPath)) {
      return { port: t.od_port, kind: 'od-daemon', prefix, rewritePath: req.url.slice(prefix.length) || '/' };
    }
    return { port: t.od_web_port, kind: 'od', prefix };
  }
  // Base-less SUB-RESOURCE request FROM an OD page (its absolute /api, /artifacts,
  // asset URLs). Recover the tenant from the Referer: daemon paths -> the daemon
  // as-is; asset paths -> the OD web with the /od/<slug> prefix restored. Exclude
  // top-level document navigations (Sec-Fetch-Dest: document) — clicking from OD
  // back to /hub or /login must still reach the control-plane, not get pushed to OD.
  const odRef = odSlugFromReferer(req);
  if (odRef && req.headers['sec-fetch-dest'] !== 'document') {
    const t = await getTenant(odRef);
    if (t?.od_web_port) {
      if (t.od_port && isDaemonPath(path)) {
        return { port: t.od_port, kind: 'od-daemon', prefix: `/od/${odRef}`, rewritePath: req.url };
      }
      return { port: t.od_web_port, kind: 'od', prefix: `/od/${odRef}`, rewritePath: `/od/${odRef}${req.url}` };
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
  if (!target || target.notFound) { socket.destroy(); return; }

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
