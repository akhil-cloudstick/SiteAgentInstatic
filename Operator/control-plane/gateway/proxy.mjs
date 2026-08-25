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
import * as tenantRuntime from '../runtime/tenantRuntime.mjs';
import { ensureOdUp, ensureTenantUp } from '../provisioner/provision.mjs';
import { startingPage } from './starting.mjs';

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

// ---- Product Hub context hand-off ---------------------------------------
//
// The MMSBUILD shared-header contract requires every route into a specialist
// product to carry the authorized scope, so the product can render it in row 2
// and return to the exact Hub view on "Back to Product Hub". Instatic receives
// it as query params on its SSO URL (see hub.mjs `hubContextParams`); the
// OpenDesign SPA has no such entry point — it is a client-rendered document —
// so the gateway writes the same scope into the document as `window.__mmsHub`,
// which `apps/web/src/state/hubContext.ts` validates and consumes.
//
// The scope is derived from the SIGNED session only, never from the URL: a
// hand-edited address cannot widen it. The registry is infrastructure-only
// (slug, ports, tier, owner) and holds no project record, so `project` is sent
// as null rather than invented — the contract forbids substituting a default,
// and the header renders the narrower scope cleanly.
// "harbour-suites" -> "Harbour Suites"; "acme_co" -> "Acme Co".
function titleFromSlug(slug) {
  return String(slug || '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// The signed-in person, from the only identity the registry holds. Initials feed
// the shared header's account avatar; two letters at most, like the reference.
function userFromTenant(tenant) {
  const local = String(tenant?.owner_email || '').split('@')[0];
  const name = titleFromSlug(local) || titleFromSlug(tenant?.slug) || null;
  if (!name) return null;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return { name, initials: initials || name.slice(0, 2).toUpperCase() };
}

function hubContextFor(tenant) {
  const client = titleFromSlug(tenant?.slug) || null;
  return {
    hubBaseUrl: `${config.gatewayOrigin}/hub`,
    role: 'operator',
    user: userFromTenant(tenant),
    client,
    // No project record exists in the control-plane registry yet. Absent, not
    // guessed — MMS Design shows the client scope and its own project chooser.
    project: null,
    site: tenant?.slug || null,
    origin: 'hub',
    returnUrl: `${config.gatewayOrigin}/hub`,
  };
}

// Serialized into a <script> block. Only `<` needs escaping: an unescaped
// `</script>` inside a JSON string would close the element early. U+2028/9
// are legal inside JS string literals since ES2019, so they need no handling.
function hubContextScript(context) {
  const json = JSON.stringify(context).replace(/</g, "\\u003c");
  return `<script>window.__mmsHub=${json}</script>`;
}

// Is this a top-level document navigation (as opposed to a sub-resource)? Only
// documents carry the injected scope; `_next` assets and API calls must stream
// through untouched.
function isDocumentRequest(req) {
  const dest = req.headers['sec-fetch-dest'];
  if (dest) return dest === 'document';
  return (req.headers.accept || '').includes('text/html');
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

// Readiness probe the waiting page polls. Answered by the gateway itself, so it
// must be recognised BEFORE the Referer rule below — a fetch() issued from a
// waiting page served at /design/sso carries that Referer and would otherwise be
// rewritten into the OpenDesign web build.
const READY_PATH = '/_mms/ready';

// Where to send someone once the backend they were waiting for is up.
//
// For the design hand-off this is NOT the URL they asked for. That URL carries a
// signed SSO token with a 120-second TTL, and the daemon answers an expired one
// with a hard 401 rather than bouncing back to the hub — so replaying it after a
// two-minute wait is guaranteed to fail. /sso/design mints a fresh token instead.
function continueUrlFor(req, path, restPath) {
  if (path.startsWith(OD_PREFIX) && restPath && (restPath === '/sso' || restPath.startsWith('/sso?'))) {
    const deep = new URL(req.url, 'http://x').searchParams.get('redirect');
    const safe = typeof deep === 'string' && deep.startsWith('/') && !deep.startsWith('//') ? deep : null;
    return safe ? `/sso/design?next=${encodeURIComponent(safe)}` : '/sso/design';
  }
  return req.url || path;
}

// A backend that is not up YET (as opposed to one that does not exist). The
// caller turns this into the waiting page for a navigation, or a 503 with
// Retry-After for a sub-resource — never into a raw connection error.
function startingTarget({ tool, continueUrl, state }) {
  return { starting: { tool, continueUrl, error: state?.starting ? null : (state?.error ?? null) } };
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
  const { port, prefix, rewritePath, injectHead, kind } = target;
  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${port}`;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-for'] = req.socket?.remoteAddress || '';
  // The OD daemon gates its privileged routes (connector connect/disconnect,
  // Composio config, library pairing, db verify/vacuum) behind
  // `requireLocalDaemonRequest`, which insists the request LOOK local on all
  // three axes: loopback peer, loopback Host, loopback Origin. We already
  // satisfy the first two (we dial 127.0.0.1 and rewrite Host above), but the
  // browser stamps the public funnel Origin, so every one of those routes 403s
  // "request origin must be a loopback daemon origin" — the whole connector UI
  // is dead behind the gateway. OD_ALLOWED_ORIGINS does NOT help: that guard
  // never reads it.
  //
  // Present the daemon's own loopback origin instead — but ONLY when the
  // browser's Origin is EXACTLY our gateway origin. That is the proof the call
  // came from a page we served, on the session this cookie authorizes. A
  // cross-site attacker's request carries its own Origin, fails this equality,
  // is forwarded unrewritten, and is still rejected by OD's own /api origin
  // guard — so this widens nothing for anyone but our first-party app.
  if (kind === 'od-daemon' && headers.origin === config.gatewayOrigin) {
    headers.origin = `http://127.0.0.1:${port}`;
  }
  // Rewriting the body means reading it, so ask the upstream for identity
  // encoding rather than teaching this proxy to gunzip. Only the (small,
  // single) SPA document takes this path; every asset still streams compressed.
  if (injectHead) delete headers['accept-encoding'];

  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: rewritePath || req.url, headers },
    (up) => {
      const outHeaders = rewriteLocation(up.headers, prefix);
      const isHtml = (up.headers['content-type'] || '').includes('text/html');
      if (!injectHead || !isHtml) {
        res.writeHead(up.statusCode || 502, outHeaders);
        up.pipe(res);
        return;
      }
      // Buffer the document so the scope can be written into <head> BEFORE the
      // app's own scripts run — the shell reads `window.__mmsHub` during its
      // first render, so a tag appended after the bundle would arrive too late.
      const chunks = [];
      up.on('data', (chunk) => chunks.push(chunk));
      up.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        const at = html.indexOf('<head>');
        html = at >= 0
          ? html.slice(0, at + 6) + injectHead + html.slice(at + 6)
          : injectHead + html;
        const body = Buffer.from(html, 'utf8');
        const finalHeaders = { ...outHeaders, 'content-length': String(body.length) };
        delete finalHeaders['transfer-encoding'];
        res.writeHead(up.statusCode || 502, finalHeaders);
        res.end(body);
      });
      up.on('error', () => { if (!res.writableEnded) res.end(); });
    },
  );
  upstream.on('error', (err) => {
    // The backend went away between our readiness check and this dial. Forget
    // the readiness verdict so the very next request re-runs ensure() and brings
    // it back, and show the waiting page rather than the raw socket error that
    // used to dead-end here.
    if (target.readySlug) {
      if (kind === 'instatic') tenantRuntime.markUnavailable(target.readySlug);
      else odRuntime.markUnavailable(target.readySlug);
    }
    if (kind === 'od') odRuntime.markSharedWebUnavailable();
    if (res.headersSent) { res.end(); return; }
    if (target.starting || target.continueUrl) {
      serveStarting(req, res, {
        tool: kind === 'instatic' ? 'cms' : 'design',
        continueUrl: target.continueUrl || '/hub',
        error: null,
      });
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
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
      // The daemon is only guaranteed to exist, not to be LISTENING: boot resume
      // spawns it and it then spends minutes registering plugins off the share.
      // Make this request responsible for the backend it is about to dial.
      const state = await ensureOdUp(t);
      const continueUrl = continueUrlFor(req, path, restPath);
      if (!state.ready) return startingTarget({ tool: 'design', continueUrl, state });
      return {
        port: t.od_port,
        kind: 'od-daemon',
        prefix: OD_PREFIX,
        rewritePath: req.url.slice(OD_PREFIX.length) || '/',
        readySlug: t.slug,
        continueUrl,
      };
    }
    // The SPA document itself. Carry the authorized Product Hub scope into it
    // so row 2 can show the real client, `Back to Product Hub` has a
    // destination, and the account avatar shows the signed-in user — the
    // shared-header contract's "context and return" requirement. Assets and
    // client-side route changes never reach here, so this runs once per load.
    // One Next process serves every tenant, so while it is down /design refused
    // connections for all of them at once. Same treatment as the daemons.
    const web = odRuntime.ensureSharedWeb();
    if (!web.ready) return startingTarget({ tool: 'design', continueUrl: req.url || path, state: web });
    const target = { port: odRuntime.sharedWebPort(), kind: 'od', prefix: OD_PREFIX, continueUrl: req.url || path };
    if (isDocumentRequest(req)) {
      const slug = sessionSlug(req);
      const tenant = slug ? await getTenant(slug) : null;
      // No session, or a session whose tenant is gone: inject nothing. The app
      // then renders its no-Hub shape rather than a stale or borrowed scope.
      if (tenant) target.injectHead = hubContextScript(hubContextFor(tenant));
    }
    return target;
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
        if (t?.od_port) {
          const state = await ensureOdUp(t);
          if (!state.ready) return startingTarget({ tool: 'design', continueUrl: '/sso/design', state });
          return { port: t.od_port, kind: 'od-daemon', prefix: OD_PREFIX, rewritePath: req.url, readySlug: t.slug, continueUrl: '/sso/design' };
        }
      }
    } else {
      const web = odRuntime.ensureSharedWeb();
      if (!web.ready) return startingTarget({ tool: 'design', continueUrl: '/design', state: web });
      return {
        port: odRuntime.sharedWebPort(),
        kind: 'od',
        prefix: OD_PREFIX,
        rewritePath: `${OD_PREFIX}${req.url}`,
        continueUrl: '/design',
      };
    }
  }
  const slug = sessionSlug(req);
  if (slug) {
    const t = await getTenant(slug);
    if (t?.port) {
      // Same guarantee as the design side. This one rarely triggers today only
      // because a tenant's bun process tends to outlive the control plane —
      // which is luck, not a design, and it hid this whole class of failure.
      const state = await ensureTenantUp(t);
      if (!state.ready) return startingTarget({ tool: 'cms', continueUrl: req.url || path, state });
      return { port: t.port, kind: 'instatic', readySlug: t.slug, continueUrl: req.url || path };
    }
  }
  return null;
}

// Serve the "still starting" verdict. A top-level navigation gets the waiting
// page, which polls READY_PATH and continues on its own. A sub-resource cannot
// act on an HTML page, so it gets a 503 with Retry-After — which the SPA and the
// browser both understand, unlike the 502 + raw socket-error text this used to
// answer with.
function serveStarting(req, res, starting) {
  const isDocument = isDocumentRequest(req);
  if (!isDocument) {
    res.writeHead(503, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '5',
    });
    res.end(starting.error || 'backend starting');
    return;
  }
  const body = startingPage(starting);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

// GET /_mms/ready?tool=design|cms — polled by the waiting page.
//
// Scoped to the SIGNED session, exactly like every other route here: it reports
// only on the tenant whose cookie the request carries, so it cannot be used to
// probe another tenant's backends. Each poll re-runs ensure(), so a backend that
// dies again mid-wait is restarted rather than waited on forever.
async function serveReady(req, res) {
  const tool = new URL(req.url, 'http://x').searchParams.get('tool') === 'cms' ? 'cms' : 'design';
  const json = (payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  const slug = sessionSlug(req);
  if (!slug) { json({ ready: false, signedOut: true }); return; }
  const tenant = await getTenant(slug);
  if (!tenant) { json({ ready: false, signedOut: true }); return; }

  if (tool === 'cms') {
    const state = await ensureTenantUp(tenant);
    json({ ready: !!state.ready, error: state.ready ? null : (state.error ?? null) });
    return;
  }
  // Design needs BOTH halves: the tenant's own daemon and the shared web shell.
  const daemon = await ensureOdUp(tenant);
  const web = odRuntime.ensureSharedWeb();
  json({
    ready: !!daemon.ready && !!web.ready,
    error: daemon.ready ? null : (daemon.error ?? null),
  });
}

// HTTP proxy. Returns true if it handled (proxied) the request; false lets the
// control-plane fall through to its own routes / 404 / login bounce.
export async function handleGatewayProxy(req, res, method, path) {
  // Before resolveBackend: this path must not be mistaken for a base-less
  // OpenDesign sub-resource by the Referer rule (the waiting page that polls it
  // is served under /design).
  if (path === READY_PATH) { await serveReady(req, res); return true; }

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
  if (target.starting) {
    serveStarting(req, res, target.starting);
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
  if (!target || target.notFound || target.redirect || target.status || target.starting) { socket.destroy(); return; }

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
