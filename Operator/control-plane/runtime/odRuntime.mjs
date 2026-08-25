// OpenDesignRuntime — runs each tenant's OpenDesign as its own daemon process
// (own OD_DATA_DIR + port), mirroring TenantRuntime for Instatic. Isolation is by
// process + data dir: an OD daemon only ever sees the projects in its own data dir.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync, rmSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';
import { signTenantToken } from '../lib/crypto.mjs';
import { isPortOpen, waitPortOpen } from '../lib/ports.mjs';

const isWin = process.platform === 'win32';
const running = new Map(); // slug -> { child, port, pid, slug }

// ---- readiness + supervision ---------------------------------------------
// `running` only means "we spawned a process". It does NOT mean the daemon is
// LISTENING, and the gap between the two is minutes here: this daemon registers
// 460 bundled plugins off a network share before it binds. The gateway used to
// forward into that gap and hand the browser a raw
// `gateway: upstream unavailable (ECONNREFUSED)`.
//
//   ready    — the port has answered at least once, so forwarding is safe. This
//              is the ONLY thing the request path reads: a Set lookup, no I/O.
//   inflight — one start+wait per slug no matter how many requests pile up.
//   params   — what start() was called with, so the supervisor can respawn.
//   stopping — slugs we killed on purpose; never fight a deliberate stop.
const ready = new Set();
const inflight = new Map();
const lastParams = new Map();
const supervised = new Map();
const stopping = new Set();

// A cold daemon needs minutes on this host, so give one wait room to finish
// instead of thrashing spawns. Callers poll, so this is a ceiling, not a stall.
const START_TIMEOUT_MS = Number(process.env.OD_START_TIMEOUT_MS || 300_000);
const WEB_START_TIMEOUT_MS = Number(process.env.OD_WEB_START_TIMEOUT_MS || 180_000);
// Backoff for UNREQUESTED restarts (a daemon that died on its own). A
// request-driven ensure() is never gated by this: someone is waiting on a page.
const RESTART_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

// Per-tenant OD data dir (LOCAL disk — SQLite can't run on the SMB share).
export function odPaths(slug) {
  const dataDir = resolve(config.odDataBase, slug);
  return { dataDir, log: resolve(dataDir, 'daemon.log') };
}

export const isRunning = (slug) => running.has(slug);
export const listRunning = () => [...running.values()].map((r) => ({ slug: r.slug, port: r.port, pid: r.pid }));

// Has this tenant's daemon answered its port? Checked before every forward, so
// it stays O(1) and free of I/O.
export const isReady = (slug) => ready.has(slug);

// Forget a readiness verdict. The gateway calls this when a forward fails
// mid-flight (the daemon died between our check and our dial) so the very next
// request re-runs ensure() and brings it back, instead of refusing again.
export function markUnavailable(slug) {
  ready.delete(slug);
}

// Why the last start attempt failed, for the waiting page to show.
export const startError = (slug) => supervised.get(slug)?.why ?? null;

// Guarantee this tenant's daemon is coming up, and report whether it is usable
// NOW. Deliberately synchronous: the request path must never block on a boot.
//
//   { ready: true }                  -> forward immediately
//   { ready: false, starting: true } -> serve the waiting page; it polls back
//
// tenant: { slug, odPort, instaticUrl?, mediaKeys? } — same shape as start().
export function ensure(tenant) {
  const slug = tenant?.slug;
  const odPort = tenant?.odPort;
  if (!slug || !odPort) return { ready: false, starting: false, error: 'no OpenDesign port for this tenant' };
  if (ready.has(slug)) return { ready: true };
  if (inflight.has(slug)) return { ready: false, starting: true, error: startError(slug) };

  const job = (async () => {
    // ADOPT before spawning. The port may already be served by a daemon we
    // started that is still warming up, or by one orphaned when the control
    // plane was killed rather than stopped. A second process on that port dies
    // of EADDRINUSE and — with the supervisor below — would loop forever.
    if (!(await isPortOpen(odPort))) {
      lastParams.set(slug, tenant);
      start(tenant);
    }
    const ok = await waitPortOpen(odPort, START_TIMEOUT_MS);
    if (ok) {
      ready.add(slug);
      clearSupervision(slug);
    }
    return ok;
  })();

  inflight.set(slug, job);
  job.catch(() => false).finally(() => { if (inflight.get(slug) === job) inflight.delete(slug); });
  return { ready: false, starting: true, error: startError(slug) };
}

// A daemon that exited on its own used to stay dead until the next control-plane
// restart, refusing every /design request in between. Bring it back, with
// backoff so one that cannot start does not spin.
function scheduleRestart(slug, why) {
  if (stopping.has(slug)) return;          // we killed it; not a fault
  if (!lastParams.has(slug)) return;       // never ours to supervise
  const sup = supervised.get(slug) || { retries: 0, timer: null };
  sup.why = why;
  supervised.set(slug, sup);
  if (sup.timer) return;
  // Out of unattended retries: leave it. A request-driven ensure() can still
  // spawn it, and the waiting page shows `why` rather than spinning forever.
  if (sup.retries >= RESTART_DELAYS_MS.length) return;
  const delay = RESTART_DELAYS_MS[sup.retries];
  sup.retries += 1;
  sup.timer = setTimeout(() => {
    sup.timer = null;
    if (!stopping.has(slug) && !running.has(slug)) ensure(lastParams.get(slug));
  }, delay);
  sup.timer.unref?.();
}

function clearSupervision(slug) {
  const sup = supervised.get(slug);
  if (sup?.timer) clearTimeout(sup.timer);
  supervised.delete(slug);
}

// The OD web is built ONCE and shared by every tenant: its Next basePath is a
// fixed, tenant-agnostic `/design`, and the gateway resolves which daemon a request
// belongs to from the hub session cookie. basePath is a BUILD-TIME constant, so
// the old per-tenant `/od/<slug>` forced one build (and one `next start`) per
// tenant — 50 tenants meant 50 builds and 50 Node processes. Do not reintroduce
// a per-tenant prefix here. See docs/opendesign-shared-web-build.md.
export const SHARED_WEB_PREFIX = '.next-prod-shared-';

// Newest valid production web build. Builds are versioned
// (`.next-prod-shared-<n>`, n = build time in ms) so a rebuild never touches the
// dir `next start` is serving. Returns the dir NAME (relative to apps/web) or null.
function newestBuildDir() {
  const webCwd = resolve(config.openDesignDir, 'apps', 'web');
  const pfx = SHARED_WEB_PREFIX;
  let best = null;
  let bestN = -1;
  let entries = [];
  try { entries = readdirSync(webCwd); } catch { return null; }
  for (const name of entries) {
    if (!name.startsWith(pfx)) continue;
    const n = Number(name.slice(pfx.length));
    if (Number.isFinite(n) && n > bestN && isCompleteBuild(resolve(webCwd, name))) {
      bestN = n;
      best = name;
    }
  }
  return best;
}

// A build dir is only usable once it is FINISHED. `BUILD_ID` is written early in
// the build, so testing it alone can hand `next start` a half-written directory
// mid-rebuild — which both serves a broken app and makes the build itself fail
// ("Cannot find module …/server/next-font-manifest.json"). `required-server-files.json`
// is written at the END of a server-mode build, so it is the honest completion marker.
function isCompleteBuild(dir) {
  return existsSync(resolve(dir, 'BUILD_ID')) && existsSync(resolve(dir, 'required-server-files.json'));
}

// Media provider id -> the env var OpenDesign reads it from. These names are
// the FIRST entry of each slot in OpenDesign's own ENV_KEYS table
// (apps/daemon/src/media/config.ts), and its resolveProviderConfig() checks the
// environment ahead of any tenant-stored key — so injecting here makes the
// operator's key win without touching OpenDesign at all. Keep this map in sync
// with MEDIA_PROVIDER_IDS in registry/settings.mjs.
const MEDIA_KEY_ENV = {
  openrouter: 'OD_OPENROUTER_API_KEY',
  replicate: 'OD_REPLICATE_API_TOKEN',
  fal: 'OD_FAL_KEY',
  bfl: 'OD_BFL_API_KEY',
  elevenlabs: 'OD_ELEVENLABS_API_KEY',
  google: 'OD_GOOGLE_API_KEY',
  minimax: 'OD_MINIMAX_API_KEY',
  kling: 'OD_KLING_API_KEY',
  aihubmix: 'OD_AIHUBMIX_API_KEY',
  tavily: 'OD_TAVILY_API_KEY',
};

function mediaKeyEnv(mediaKeys) {
  const out = {};
  for (const [id, key] of Object.entries(mediaKeys || {})) {
    const name = MEDIA_KEY_ENV[id];
    if (name && typeof key === 'string' && key.trim()) out[name] = key.trim();
  }
  return out;
}

// tenant: { slug, odPort, instaticUrl?, mediaKeys? }
// Spawns ONLY this tenant's daemon. The web UI comes from the single shared Next
// process (startSharedWeb) — see the note above SHARED_WEB_PREFIX.
export function start(tenant) {
  const { slug, odPort } = tenant;
  if (running.has(slug)) return running.get(slug);
  // Remember HOW to start this tenant. Every caller (boot resume, provisioning,
  // ensure()) comes through here, so the supervisor can respawn a daemon that
  // died without going back to the registry for the decrypted secrets.
  lastParams.set(slug, tenant);
  stopping.delete(slug);

  const p = odPaths(slug);
  mkdirSync(p.dataDir, { recursive: true });

  const daemonCwd = resolve(config.openDesignDir, 'apps', 'daemon');
  const origin = `http://127.0.0.1:${odPort}`;
  const webPort = sharedWebPort();
  const env = {
    ...process.env,
    // libuv runs every fs call on a threadpool that defaults to FOUR threads, so
    // the daemon can only ever have 4 file operations in flight. That is fine on
    // a local SSD and ruinous here: this repo is served from a network share, so
    // each call is a round trip and the daemon spends its time waiting, four at
    // a time. The endpoints that walk a directory tree (design systems, skills,
    // prompt templates, plugins) and the plugin registration that gates startup
    // are all bound by exactly this. Measured on this share: 266 design-system
    // reads take 1339ms at the default and 275ms at 64 — the threads are blocked
    // on I/O, not burning CPU, so a large pool costs almost nothing.
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '64',
    OD_DATA_DIR: p.dataDir,
    OD_PORT: String(odPort),
    // The daemon trusts the web origin for /api calls via OD_WEB_PORT. Every
    // tenant's browser now loads the SAME shared web, so this is one fixed port
    // rather than a per-tenant one; without it the daemon 403s "Cross-origin
    // requests are not allowed". (allowedBrowserPorts() reads OD_WEB_PORT.)
    // Belt-and-suspenders: also list the web origins explicitly.
    OD_WEB_PORT: String(webPort),
    OD_ALLOWED_ORIGINS: [
      origin,
      `http://localhost:${odPort}`,
      `http://127.0.0.1:${webPort}`,
      `http://localhost:${webPort}`,
      // Public gateway: browser /api calls arrive with the funnel Origin, proxied
      // straight to this daemon — it must trust that origin for CSRF.
      config.gatewayOrigin,
    ].join(','),
    // SSO: the control-plane signs a short-lived token; the OD daemon verifies it
    // with this same secret and mints its own session (Phase 3b, OD-side /sso).
    OD_SSO_SECRET: config.tokenSecret,
    OD_TENANT_SLUG: slug,
    // ONE LOGIN: where to bounce an unauthenticated page load. The hub silently
    // re-mints an SSO token when the hub session is alive, so an expired
    // od_session never surfaces a second login form. See hub.mjs `/sso/<tool>`.
    OD_HUB_SSO_URL: `${config.gatewayOrigin}/sso/design`,
    // Public gateway origin — so "Share to CMS" can hand the BROWSER a reachable CMS
    // URL (the tenant's Instatic is session-routed at <gatewayOrigin>/cms), not the
    // daemon's localhost OD_INSTATIC_URL which a remote client can't reach.
    OD_GATEWAY_ORIGIN: config.gatewayOrigin,
    // Advanced tenants: where this tenant's Instatic lives, so "Share to CMS" can
    // push there. Unset for lite tenants (no Instatic) -> the button is inert.
    ...(tenant.instaticUrl ? { OD_INSTATIC_URL: tenant.instaticUrl } : {}),
    // Advanced tenants also get the website build rule OD must follow so their
    // pages import into Instatic cleanly. OD reads this file live (cached by
    // mtime), so editing it updates the enforced rule with no redeploy. Only
    // pass it when the file exists; OD falls back to its embedded rule otherwise.
    ...(tenant.instaticUrl && existsSync(config.cmsRuleFile)
      ? { OD_CMS_RULE_FILE: config.cmsRuleFile }
      : {}),
    // Operator-managed AI (Phase 6): managed mode points OD's AI at the
    // control-plane's key-hiding gateway (same per-tenant signed token as
    // Instatic). The real provider key NEVER enters the OD process — it stays in
    // the control-plane. OD_MANAGED_AI signals the web app to hide the BYOK UI.
    //
    // The `/design` segment is what tells the gateway this traffic is MMS Design
    // rather than the tenant's CMS, so it resolves the operator's MMS Design
    // model instead of the CMS category map. It is carried in the base URL (not
    // a header) because OD's model calls are emitted by an `opencode` child
    // process whose headers we don't control. See ai-gateway/gateway.mjs.
    //
    // This URL embeds a signed tenant token and is therefore a CREDENTIAL: it
    // must stay inside the daemon process and never be handed to the browser.
    OD_MANAGED_AI: '1',
    OD_AI_GATEWAY_URL: `${config.publicBaseUrl}/ai/${signTenantToken(slug)}/design/v1`,
    // Operator-owned media provider keys (image / video / speech generation).
    ...mediaKeyEnv(tenant.mediaKeys),
  };
  // Clear inherited control-plane secrets the child shouldn't see.
  delete env.SETTINGS_ENC_KEY;

  const out = createWriteStream(p.log, { flags: 'a' });
  out.write(`\n[od-runtime] starting ${slug} on :${odPort} @ ${new Date().toISOString()}\n`);

  // The daemon serves the API + tenant SSO (/sso) + the auth gate — NOT the web UI.
  // The web UI is served by a per-tenant Next.js dev server (below) that proxies
  // /api, /artifacts, /frames, and /sso back to this daemon. (OpenDesign's
  // production `next build` is currently blocked by an upstream Next.js 16.2 bug,
  // so we serve the web via `next dev` — the mode OpenDesign already runs reliably.)
  const daemon = spawn('node', ['bin/od.mjs', '--port', String(odPort), '--no-open'], {
    cwd: daemonCwd, env, shell: isWin, windowsHide: true,
  });
  daemon.stdout.on('data', (d) => out.write(d));
  daemon.stderr.on('data', (d) => out.write(d));
  daemon.on('exit', (code) => {
    out.write(`\n[od-runtime] ${slug} daemon exited code=${code} @ ${new Date().toISOString()}\n`);
    running.delete(slug);
    ready.delete(slug);
    scheduleRestart(slug, `the design daemon exited (code ${code})`);
  });
  daemon.on('error', (err) => {
    out.write(`\n[od-runtime] ${slug} daemon spawn error: ${err?.message ?? err}\n`);
    running.delete(slug);
    ready.delete(slug);
    scheduleRestart(slug, `the design daemon could not start: ${err?.message ?? err}`);
  });

  // NOTE: no per-tenant web is spawned here any more. ONE shared Next process
  // (startSharedWeb, below) serves every tenant; the gateway routes each request
  // to this daemon using the hub session cookie.
  const rec = { child: daemon, web: null, port: odPort, webPort: sharedWebPort(), pid: daemon.pid, slug };
  running.set(slug, rec);
  // Watch it up. Boot resume and provisioning call start() directly, so without
  // this the first request after a restart would always meet an "unready" daemon
  // and show the waiting page even though it had been booting for minutes.
  waitPortOpen(odPort, START_TIMEOUT_MS).then((ok) => {
    if (ok && running.has(slug)) { ready.add(slug); clearSupervision(slug); }
  });
  return rec;
}

// The single port the shared OD web listens on (all tenants).
export function sharedWebPort() {
  return config.odWebBasePort;
}

// True once a valid production web build exists (shared by every tenant).
export function isWebBuilt() {
  return newestBuildDir() !== null;
}

// ── Shared OD web ───────────────────────────────────────────────────────────
// One Next process for ALL tenants. It is tenant-agnostic: it renders the UI
// shell and nothing else. Every daemon-owned path (/api, /sso, /artifacts,
// /frames) is intercepted by the gateway BEFORE it reaches Next and sent to the
// session's own daemon, so this process never needs to know which tenant it is
// serving — and per-tenant data isolation still lives entirely in the daemons.
let sharedWeb = null;
let sharedWebReady = false;
let sharedWebInflight = null;

export const isSharedWebRunning = () => sharedWeb !== null && !sharedWeb.killed;
export const isSharedWebReady = () => sharedWebReady;

// The SPA shell carries the same exposure as the daemons: while this ONE process
// is down, /design refused connections for EVERY tenant at once. Same contract as
// ensure() — never blocks, and says whether forwarding is safe yet.
export function ensureSharedWeb() {
  if (sharedWebReady) return { ready: true };
  if (sharedWebInflight) return { ready: false, starting: true };
  const port = sharedWebPort();
  const job = (async () => {
    // Adopt a web that is already listening: startSharedWeb() reaps whatever
    // holds this port, so calling it blindly would kill a healthy shared web.
    if (!(await isPortOpen(port))) startSharedWeb();
    const ok = await waitPortOpen(port, WEB_START_TIMEOUT_MS);
    if (ok) sharedWebReady = true;
    return ok;
  })();
  sharedWebInflight = job;
  job.catch(() => false).finally(() => { if (sharedWebInflight === job) sharedWebInflight = null; });
  return { ready: false, starting: true };
}

export function markSharedWebUnavailable() {
  sharedWebReady = false;
}

// Kill anything already listening on the shared web port that we did not spawn.
// Without this, a leftover per-tenant `next start` from the OLD model (or a web
// orphaned when the control plane was killed rather than stopped) squats the port,
// the shared web dies with EADDRINUSE, and the gateway then forwards /design to
// that stale process — which serves a different basePath and answers 500.
function reapStaleWebOnPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p TCP | findstr LISTENING | findstr :${port}`, { encoding: 'utf8', windowsHide: true });
      const pids = new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p) && p !== '0'));
      for (const pid of pids) {
        if (Number(pid) === process.pid) continue;
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true }); } catch { /* already gone */ }
      }
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    }
  } catch { /* nothing listening — the normal case */ }
}

export function startSharedWeb() {
  if (sharedWeb) return sharedWeb;
  const webPort = sharedWebPort();
  reapStaleWebOnPort(webPort);
  const webCwd = resolve(config.openDesignDir, 'apps', 'web');
  const nextBin = resolve(config.openDesignDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  const logDir = resolve(config.odDataBase, '_shared-web');
  mkdirSync(logDir, { recursive: true });
  const out = createWriteStream(resolve(logDir, 'web.log'), { flags: 'a' });

  // Builds are VERSIONED (.next-prod-shared-<n>): a rebuild always writes a fresh
  // dir, so it never fights the one `next start` is serving (no rename/lock races
  // on Windows). Serve the NEWEST valid build; best-effort delete the older ones.
  const prodDist = newestBuildDir();
  const isBuilt = !!prodDist;
  if (isBuilt) {
    try {
      for (const name of readdirSync(webCwd)) {
        if (name.startsWith(SHARED_WEB_PREFIX) && name !== prodDist) {
          try { rmSync(resolve(webCwd, name), { recursive: true, force: true }); } catch { /* still locked; cleaned next boot */ }
        }
      }
    } catch { /* dir listing failed; ignore */ }
  }

  const webEnv = {
    ...process.env,
    OD_WEB_PORT: String(webPort),
    // Only the gateway origin and this shared web's own origin are trusted. There
    // is no per-tenant web origin any more.
    OD_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort},${config.gatewayOrigin}`,
    // FIXED, tenant-agnostic basePath — the whole point of the shared build.
    OD_WEB_BASE_PATH: '/design',
    NEXT_PUBLIC_OD_MANAGED_AI: '1',
    ...(isBuilt
      ? { OD_WEB_OUTPUT_MODE: 'server', OD_WEB_DIST_DIR: prodDist, NODE_ENV: 'production' }
      : { OD_WEB_DIST_DIR: '.next-shared', WATCHPACK_POLLING: 'true', CHOKIDAR_USEPOLLING: 'true' }),
  };
  delete webEnv.SETTINGS_ENC_KEY;

  const webArgs = isBuilt
    ? [nextBin, 'start', '--port', String(webPort)]
    : [nextBin, 'dev', '--turbopack', '--port', String(webPort)];
  out.write(`\n[od-runtime] shared web: ${isBuilt ? 'PRE-BUILT (next start — fast)' : 'DEV (next dev — build it for speed)'} on :${webPort} @ ${new Date().toISOString()}\n`);

  sharedWeb = spawn('node', webArgs, { cwd: webCwd, env: webEnv, shell: isWin, windowsHide: true });
  sharedWeb.stdout.on('data', (d) => out.write(d));
  sharedWeb.stderr.on('data', (d) => out.write(d));
  sharedWeb.on('exit', (code) => { out.write(`\n[od-runtime] shared web exited code=${code}\n`); sharedWeb = null; sharedWebReady = false; });
  sharedWeb.on('error', (err) => { out.write(`\n[od-runtime] shared web spawn error: ${err?.message ?? err}\n`); sharedWeb = null; sharedWebReady = false; });
  waitPortOpen(webPort, WEB_START_TIMEOUT_MS).then((ok) => { if (ok && sharedWeb) sharedWebReady = true; });
  return sharedWeb;
}

export function stopSharedWeb() {
  sharedWebReady = false;
  if (!sharedWeb) return;
  const pid = sharedWeb.pid;
  sharedWeb = null;
  try {
    if (isWin) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else process.kill(pid, 'SIGTERM');
  } catch { /* already gone */ }
}

// Produce the ONE shared PRODUCTION web build — server mode (avoids the
// export-only Next 16.2.6 bug) with a fixed, tenant-agnostic `/design` basePath.
// Run once per OD source upgrade, NOT once per tenant: nothing tenant-specific
// is baked in, so 1 build serves 50 tenants. Uses a throwaway tsconfig so
// `next build` doesn't rewrite the committed apps/web/tsconfig.json.
// Resolves on success, rejects on a non-zero exit.
//
// No OD_PORT is baked into the /api rewrite: the gateway intercepts every
// daemon-owned path before it reaches Next and forwards it to the session's own
// daemon, so a build-time port would be both wrong and unused behind the funnel.
export function buildWeb() {
  return new Promise((resolvePromise, reject) => {
    const webCwd = resolve(config.openDesignDir, 'apps', 'web');
    const nextBin = resolve(config.openDesignDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    const logDir = resolve(config.odDataBase, '_shared-web');
    mkdirSync(logDir, { recursive: true });
    const out = createWriteStream(resolve(logDir, 'web.log'), { flags: 'a' });
    out.write(`\n[od-runtime] building SHARED web (production, basePath=/design) @ ${new Date().toISOString()}\n`);
    const env = {
      ...process.env,
      OD_WEB_BASE_PATH: '/design',
      OD_WEB_OUTPUT_MODE: 'server',
      // NEXT_PUBLIC_* is inlined at BUILD time, so setting this only on the
      // `next start` env (below, in startSharedWeb) never reached the client
      // bundle. The shared build serves tenants exclusively, so managed mode is
      // a constant here: no first-run onboarding, no tenant-facing BYOK step.
      NEXT_PUBLIC_OD_MANAGED_AI: '1',
      // Build to a fresh VERSIONED dir (…-<ms>) so a rebuild never fights the dir the
      // running web is serving; the next restart picks up the newest.
      OD_WEB_DIST_DIR: `${SHARED_WEB_PREFIX}${Date.now()}`,
      OD_WEB_TSCONFIG_PATH: 'tsconfig.build.json',
      NODE_ENV: 'production',
    };
    delete env.SETTINGS_ENC_KEY;
    const child = spawn('node', [nextBin, 'build'], { cwd: webCwd, env, shell: isWin, windowsHide: true });
    child.stdout.on('data', (d) => out.write(d));
    child.stderr.on('data', (d) => out.write(d));
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`shared od web build exited code=${code}`))));
    child.on('error', reject);
  });
}

export function stop(slug) {
  // Record the intent BEFORE the kill: the exit handler fires asynchronously and
  // would otherwise read a deliberate stop as a crash and respawn it.
  stopping.add(slug);
  clearSupervision(slug);
  ready.delete(slug);
  const rec = running.get(slug);
  if (!rec) return false;
  for (const pid of [rec.pid, rec.webPid]) {
    if (!pid) continue;
    try {
      if (isWin) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } catch { /* best effort */ }
  }
  if (!isWin) {
    try { rec.child?.kill('SIGTERM'); rec.web?.kill('SIGTERM'); } catch { /* best effort */ }
  }
  running.delete(slug);
  return true;
}

// Poll until the daemon answers its health endpoint.
export async function waitHealthy(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.status > 0) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}
