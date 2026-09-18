// Reverse-proxy the single public funnel origin to the right per-tenant backend,
// so the operator + every tenant's OpenDesign + Instatic all live behind ONE URL.
//
//   /operator/*    -> the Astro operator console (admin sign-in required; R14).
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
import { getBusiness } from '../registry/org.mjs';
import { readActiveProducts } from '../registry/settings.mjs';
import { currentPersonCached } from '../hub/hubSession.mjs';
import { PLATFORM_BRAND, brandForTenant, brandForWire, productName } from '../lib/brand.mjs';
import { readOperatorArtwork } from '../registry/org.mjs';
import * as odRuntime from '../runtime/odRuntime.mjs';
import * as tenantRuntime from '../runtime/tenantRuntime.mjs';
import { ensureOdUp, ensureTenantUp } from '../provisioner/provision.mjs';
import { startingPage } from './starting.mjs';

// Fixed, tenant-agnostic mount point for the ONE shared OpenDesign web build.
// It must match the Next basePath in odRuntime.buildWeb()/startSharedWeb().
const OD_PREFIX = '/design';
// Connector MCP mount. Same origin, same port as everything else — only the
// path differs. Tailscale Funnel allows just 443 / 8443 / 10000, and 443 (this
// gateway) plus 10000 (tenant test funnel) are already spoken for, so giving the
// connector its own funnel would spend the last spare port on a service that
// does not need its own origin.
const CONNECTOR_PREFIX = '/connector-mcp';

// Resolve the project from the signed hub session (the cookie hub.mjs issues),
// and only while the PERSON behind it is still active and unchanged: removing
// someone, or changing their role, stops their traffic here within the cache
// window (hubSession.mjs), not at their cookie's expiry. Null when signed out.
async function sessionSlug(req) {
  const person = await currentPersonCached(req);
  return person ? person.tenant_slug : null;
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
// hand-edited address cannot widen it. `client` is the wire name for the
// Business, `project` the project's display name.
// "harbour-suites" -> "Harbour Suites"; "acme_co" -> "Acme Co".
function titleFromSlug(slug) {
  return String(slug || '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// The signed-in person. Initials feed the shared header's account avatar; two
// letters at most, like the reference.
function userFromPerson(person, tenant) {
  const local = String(person?.email || '').split('@')[0];
  const name = String(person?.display_name || '').trim() || titleFromSlug(local) || titleFromSlug(tenant?.slug) || null;
  if (!name) return null;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return { name, initials: initials || name.slice(0, 2).toUpperCase() };
}

async function hubContextFor(tenant, person) {
  const business = tenant?.business_id ? await getBusiness(tenant.business_id) : null;
  const products = await readActiveProducts();
  const brand = tenant ? await brandForTenant(tenant.slug) : PLATFORM_BRAND;
  return {
    // The Operator's mark and name, or null when this project sits directly
    // under the platform and wears MMSBUILD's (R5). The shared header reads
    // this; no product needs its own copy of the rule.
    brand: brandForWire(brand),
    // Platform staff working on this project are named as what they are, so
    // the products' own logs say "acting as", never the business itself.
    staff: person?.staff_admin_id
      ? { email: person.email || null, actingAs: business?.name || tenant?.display_name || tenant?.slug || null }
      : null,
    // The ORIGIN, not the origin + '/hub'. The shared header appends hub-relative
    // paths to this (hubLinkHref), so including '/hub' here produced '/hub/hub'.
    // Instatic's own producer (server/auth/hubContext.ts) has always sent the
    // bare origin; this is the side that disagreed.
    hubBaseUrl: config.gatewayOrigin,
    designActive: products.design,
    cmsActive: products.cms,
    // The shared header's portfolio role: a business's own people are "client".
    role: 'client',
    user: userFromPerson(person, tenant),
    client: business?.name || titleFromSlug(tenant?.slug) || null,
    project: tenant?.display_name || tenant?.slug || null,
    site: tenant?.slug || null,
    origin: 'hub',
    returnUrl: `${config.gatewayOrigin}/hub`,
  };
}

// The console's Astro dev server answers its own asset requests at the ROOT —
// `/@fs/…` for files outside the app (the shared MMS header's source, its fonts
// and logo), `/src/…` for the app's own modules, `/@vite/…` for the dev client.
// Those URLs carry no `/operator` prefix, so through this gateway they would
// fall to the tenant catch-all and 404: the console renders with no icons and a
// broken logo. Route them to the console instead — but only when the request
// came FROM the console (its page, or one of its own modules), so a tenant site
// that happens to serve `/src/...` is unaffected.
//
// A built console needs none of this: everything it serves lives under
// `/operator/_astro/`.
// `/@…` belongs to Vite and nothing else, so those route on the path alone.
// `/src/` and `/node_modules/` are ordinary-looking paths a published tenant
// site could serve, so they additionally have to come from the console.
const VITE_ONLY_PREFIXES = ['/@fs/', '/@id/', '/@vite/', '/@react-refresh'];
const SHARED_SHAPE_PREFIXES = ['/src/', '/node_modules/'];
const DEV_ASSET_PREFIXES = [...VITE_ONLY_PREFIXES, ...SHARED_SHAPE_PREFIXES];

function fromConsole(referer) {
  if (!referer) return false;
  let refPath;
  try {
    refPath = new URL(referer).pathname;
  } catch {
    return false;
  }
  return refPath === '/operator'
    || refPath.startsWith('/operator/')
    || DEV_ASSET_PREFIXES.some((p) => refPath.startsWith(p));
}

function isConsoleDevAsset(req, path) {
  if (VITE_ONLY_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (!SHARED_SHAPE_PREFIXES.some((p) => path.startsWith(p))) return false;
  return fromConsole(req.headers.referer);
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The icon addresses baked into the two products' built HTML. They are asked
// for by name, one build for every project, so answering them per-Operator is
// how a branded favicon happens at all (R5).
const BAKED_ICON_PATHS = new Set([
  '/favicon.ico', '/favicon-32x32.png', '/favicon-16x16.png', '/apple-touch-icon.png',
  '/design/favicon.ico', '/design/favicon-32x32.png', '/design/favicon-16x16.png', '/design/apple-touch-icon.png',
]);

/** The acting-as banner's contents, or null when this is an ordinary person. */
function actingFor(person, tenant) {
  if (!person?.staff_admin_id) return null;
  return {
    email: person.email || null,
    project: tenant?.display_name || tenant?.slug || null,
    business: null, // filled by the business name when the caller has it
  };
}

/** The brand this request's session means — the platform's when there is none. */
async function brandForRequest(req) {
  const slug = await sessionSlug(req);
  return slug ? brandForTenant(slug) : PLATFORM_BRAND;
}

/**
 * Answer one piece of an Operator's artwork.
 *
 * The version is in the ETag, not just in the URL, because the addresses the
 * products ask for are FIXED: without a version a browser that cached one
 * Operator's favicon at `/favicon-32x32.png` would go on showing it after a
 * rebrand, and — on a shared machine — for the next Operator too.
 */
async function serveBrandArtwork(req, res, { operatorId, artwork }) {
  const art = await readOperatorArtwork(operatorId, artwork).catch(() => null);
  if (!art) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const etag = `"op${operatorId}-${artwork}-v${art.version}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'private, max-age=0, must-revalidate', vary: 'Cookie' });
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': art.mime || 'image/png',
    'content-length': String(art.bytes.length),
    etag,
    // Private: these addresses are shared between Operators, and only the
    // session says which one is looking.
    'cache-control': 'private, max-age=0, must-revalidate',
    vary: 'Cookie',
    'x-content-type-options': 'nosniff',
  });
  res.end(art.bytes);
}

/**
 * Rewrite one built document so it wears an Operator's brand (R5, S3–S6).
 *
 * Both products bake their <title> and icon at build time, and ONE build
 * serves every project, so this is the only place a per-Operator title or
 * favicon can be applied without a build per agency.
 *
 * The title is REPLACED, never appended: a browser honours the first <title>
 * in a document, so an added one is invisible and would have looked like the
 * feature working for anyone who only checked the HTML.
 *
 * The accent is defined on `html:root` rather than `:root` so it outranks BOTH
 * the light and the dark token block in the shared stylesheet without this
 * code having to know which theme is showing.
 */
function brandDocRewriter(brand, product, acting = null) {
  if ((!brand || brand.isPlatform) && !acting) return null;
  const name = productName(brand, product);
  const parts = [];
  if (brand && !brand.isPlatform) {
    if (brand.accent) {
      parts.push(`<style>html:root{--mms-action:${brand.accent};--mms-action-strong:${brand.accent}}</style>`);
    }
    if (brand.icon) {
      parts.push(`<link rel="icon" href="${escAttr(brand.icon)}">`);
    }
  }
  const head = parts.join('');
  // The product's own name is a module-level constant in its bundle, read the
  // first time any module loads. Publishing it on the document BEFORE the
  // bundle runs is what lets "MMS-CMS" read "BrightLeaf CMS" without a build
  // per Operator — and why this goes at the START of <head>, not the end.
  const earlyHead = brand && !brand.isPlatform
    ? `<script>window.__mmsBrandName=${JSON.stringify(name).replace(/</g, '\\u003c')}</script>`
    : '';
  return (html) => {
    let out = html;
    if (brand && !brand.isPlatform) {
      out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out)
        ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escAttr(name)}</title>`)
        : out;
      if (earlyHead) {
        const open = out.indexOf('<head>');
        out = open >= 0 ? out.slice(0, open + 6) + earlyHead + out.slice(open + 6) : earlyHead + out;
      }
      if (head) {
        // At the END of <head>, so it beats the document's own <link rel=icon>
        // and the stylesheet whose token it is overriding.
        const close = out.toLowerCase().lastIndexOf('</head>');
        out = close >= 0 ? out.slice(0, close) + head + out.slice(close) : head + out;
      }
    }
    if (acting) out = out.replace(/<body([^>]*)>/i, (m) => m + actingBanner(acting));
    return out;
  };
}

/**
 * The banner platform staff see while they are inside somebody's work.
 *
 * Rendered by the gateway rather than by each product, so it is byte-identical
 * in MMS-CMS and MMS-Design and cannot be forgotten by one of them. It is not
 * dismissible: a mode you can hide is a mode you forget you are in, and this
 * one carries somebody else's customer's data.
 */
function actingBanner({ business, project, email }) {
  const who = escAttr(business || project || 'this business');
  return `<div id="mms-acting-as" role="status" style="position:sticky;top:0;z-index:2147483000;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 16px;background:#8a2a1a;color:#fff;font:600 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">`
    + `<span>Platform staff — you are acting as <strong>${who}</strong>. Everything you do is recorded.</span>`
    + `<form method="POST" action="/act-as/exit" style="margin:0">`
    + `<button type="submit" style="font:inherit;padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;cursor:pointer">End session</button>`
    + `</form></div>`;
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
  const { port, prefix, rewritePath, injectHead, kind, rewriteDoc } = target;
  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${port}`;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-for'] = req.socket?.remoteAddress || '';
  // The mount point we stripped, so the backend can rebuild a URL that comes
  // back through this gateway. Without it a backend only ever sees its own
  // rewritten path, and any absolute URL it hands out omits the prefix — which
  // is exactly how the connector's archive download URL came out as
  // `/exports/<id>` and 404ed, when the route that works is
  // `/connector-mcp/exports/<id>`.
  //
  // `rewriteLocation` already does the mirror image of this for redirects the
  // backend sends. This covers URLs a backend puts in a response BODY, which a
  // proxy cannot rewrite for it.
  //
  // Connector only, deliberately. `x-forwarded-prefix` is a header some
  // frameworks act on by rewriting their own asset and redirect URLs, and OD's
  // Next build already handles its basePath itself — sending it there risks a
  // double prefix on a surface that is working. Widen this per backend, after
  // testing that backend, rather than by default.
  if (prefix && kind === 'connector-mcp') headers['x-forwarded-prefix'] = prefix;
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
  if (injectHead || rewriteDoc) delete headers['accept-encoding'];

  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: rewritePath || req.url, headers },
    (up) => {
      const outHeaders = rewriteLocation(up.headers, prefix);
      const isHtml = (up.headers['content-type'] || '').includes('text/html');
      if ((!injectHead && !rewriteDoc) || !isHtml) {
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
        if (injectHead) {
          const at = html.indexOf('<head>');
          html = at >= 0
            ? html.slice(0, at + 6) + injectHead + html.slice(at + 6)
            : injectHead + html;
        }
        // The Operator's own name, mark and colour, written into a document
        // that was built once for everybody (R5). Both products bake their
        // title and icon at build time, and there is one build serving every
        // project, so the only place this can happen is here.
        if (rewriteDoc) html = rewriteDoc(html);
        const body = Buffer.from(html, 'utf8');
        const finalHeaders = { ...outHeaders, 'content-length': String(body.length) };
        delete finalHeaders['transfer-encoding'];
        if (rewriteDoc) {
          // A document that now carries ONE Operator's branding must never be
          // held by anything shared: the next request may belong to another.
          finalHeaders['cache-control'] = 'private, no-store';
          finalHeaders.vary = outHeaders.vary ? `${outHeaders.vary}, Cookie` : 'Cookie';
        }
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
  // Connector MCP. Checked before everything else because it is a fixed,
  // tenant-agnostic mount: it carries no hub cookie and must never fall through
  // to the Instatic catch-all. The connector authenticates callers itself with a
  // bearer token, so the gateway does not gate it — it only routes.
  if (config.connectorMcpEnabled && (path === CONNECTOR_PREFIX || path.startsWith(CONNECTOR_PREFIX + '/'))) {
    const rest = (req.url || path).slice(CONNECTOR_PREFIX.length) || '/';
    return {
      port: config.connectorMcpPort,
      kind: 'connector-mcp',
      prefix: CONNECTOR_PREFIX,
      // `/connector-mcp` is the JSON-RPC endpoint; `/connector-mcp/health` is
      // the probe. Anything else keeps its sub-path. The `?` case matters: a
      // query on the bare mount slices to `?x=1`, which is not a path and makes
      // the upstream request fail in a way that reads like the backend is down.
      rewritePath: rest === '/' ? '/mcp' : rest.startsWith('?') ? '/mcp' + rest : rest,
    };
  }
  // An Operator's own artwork, by the address the brand resolver hands out.
  // Public on purpose: a logo has to load on a sign-in page, before anybody has
  // signed in. It carries no other information — the id is already in every
  // link the same page renders.
  const art = path.match(/^\/brand\/(\d+)\/(logo|logo-dark|icon)$/);
  if (art) return { kind: 'brand-art', operatorId: art[1], artwork: { logo: 'logo', 'logo-dark': 'logoDark', icon: 'icon' }[art[2]] };

  // The icon a baked page asks for. Both products bake their favicon links at
  // build time, and one build serves every project, so the branded answer is
  // given at the address they already ask for rather than by rewriting their
  // markup (R5, S4/S6). An Operator with no icon set falls straight through to
  // the product's own.
  if (BAKED_ICON_PATHS.has(path)) {
    const brand = await brandForRequest(req);
    if (brand.icon) return { kind: 'brand-art', operatorId: brand.operatorId, artwork: 'icon' };
  }

  // Operator console (Astro, served with base=/operator). The console itself
  // requires an admin sign-in (ui/src/middleware.ts), and so does every API it calls.
  if (path === '/operator' || path.startsWith('/operator/') || isConsoleDevAsset(req, path)) {
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
    // The hub decides where a tenant LANDS; this is what makes the decision
    // stick. Without it, typing /design straight into the address bar reaches
    // the product the operator turned off. Returning null 404s it, exactly as
    // an unprovisioned tenant already does.
    if (!(await readActiveProducts()).design) return null;
    const restPath = path.slice(OD_PREFIX.length) || '/';
    if (isDaemonPath(restPath)) {
      const slug = await sessionSlug(req);
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
      const person = await currentPersonCached(req);
      const tenant = person ? await getTenant(person.tenant_slug) : null;
      // No session, or a session whose tenant is gone: inject nothing. The app
      // then renders its no-Hub shape rather than a stale or borrowed scope.
      if (tenant) {
        target.injectHead = hubContextScript(await hubContextFor(tenant, person));
        // The tab title, the icon, the accent — and the acting-as banner when
        // platform staff are inside somebody's work (R5, S5/S6).
        target.rewriteDoc = brandDocRewriter(await brandForTenant(tenant.slug), 'design', actingFor(person, tenant));
      }
    }
    return target;
  }
  // Base-less SUB-RESOURCE request FROM an OD page (an absolute /api, /artifacts
  // or asset URL that escaped the client-side basePath shim). Recognise it by the
  // Referer and restore the `/design` prefix. Exclude top-level document navigations
  // (Sec-Fetch-Dest: document) — clicking from OD back to /hub or /login must
  // still reach the control-plane, not get pushed to OD.
  if (isFromOdPage(req) && req.headers['sec-fetch-dest'] !== 'document') {
    if (!(await readActiveProducts()).design) return null;
    if (isDaemonPath(path)) {
      const slug = await sessionSlug(req);
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
  // The catch-all reaches Instatic, so this is the CMS's equivalent of the
  // /design gate above — it also covers a bare `/`, which lands here rather
  // than at /hub for a signed-in tenant.
  if (!(await readActiveProducts()).cms) return null;
  const slug = await sessionSlug(req);
  if (slug) {
    const t = await getTenant(slug);
    if (t?.port) {
      // Same guarantee as the design side. This one rarely triggers today only
      // because a tenant's bun process tends to outlive the control plane —
      // which is luck, not a design, and it hid this whole class of failure.
      const state = await ensureTenantUp(t);
      if (!state.ready) return startingTarget({ tool: 'cms', continueUrl: req.url || path, state });
      const target = { port: t.port, kind: 'instatic', readySlug: t.slug, continueUrl: req.url || path };
      // Brand the CMS's own pages — and ONLY those. This same backend serves
      // the customer's published website at root slugs, and that site is the
      // customer's own design: putting an agency's title or colour on it would
      // be rewriting somebody's published pages, which R5 never asked for.
      if (isDocumentRequest(req) && (path === '/cms' || path.startsWith('/cms/'))) {
        const person = await currentPersonCached(req);
        target.rewriteDoc = brandDocRewriter(await brandForTenant(t.slug), 'cms', actingFor(person, t));
      }
      return target;
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

  const slug = await sessionSlug(req);
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
  if (target.kind === 'brand-art') {
    await serveBrandArtwork(req, res, target);
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
