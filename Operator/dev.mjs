// dev.mjs — starts all SiteAgent services with one command: node dev.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowedSlugs, tenantAllowed, ALLOWLIST_FILE } from './control-plane/lib/connectorAllowlist.mjs';
import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as tenantsRepo from './control-plane/registry/tenants.mjs';
import { decrypt } from './control-plane/lib/crypto.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONNECTOR_DIR = resolve(HERE, '..', 'Connector');

// Read Operator/.env before anything looks at process.env (R13).
//
// The control plane has always loaded this file; this script never did, so the
// services it starts took their credentials from whatever shell happened to run
// it. That is the literal reading of what R13 rules out — "without a developer
// holding the credentials" (PRD 5.4) — and it showed up as a Connector that
// silently did not start because one terminal had `MMS_CONNECTOR_MCP_TOKEN` set
// and the next did not. Platform configuration now comes from the platform's own
// file, and an environment variable still wins where one is deliberately set.
try {
  const envFile = resolve(HERE, '.env');
  if (typeof process.loadEnvFile === 'function' && existsSync(envFile)) process.loadEnvFile(envFile);
} catch { /* the file is optional; a missing one is not a reason to refuse to start */ }

const CYAN   = '\x1b[36m';
const MAGENTA= '\x1b[35m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';

const CONNECTOR_PORT = process.env.MMS_CONNECTOR_PORT || '8787';

/** Fail-closed allowlist, shared so it can be tested without starting the stack. */
const allowed = () => allowedSlugs({ onWarn: (m) => console.log(`${DIM}connector: ${m}${RESET}`) });

/**
 * Build the connector's target map from the registry.
 *
 * The connector addresses each tenant's own Instatic directly — the public
 * gateway picks a tenant by browser cookie and a server-to-server caller has no
 * cookie, so "which tenant" has to be stated rather than inferred.
 *
 * Derived rather than hand-configured because a hand-written `MMS_TARGETS` goes
 * stale the moment a tenant is added, and because the connector was previously
 * started by hand outside this script: killing those processes took the whole
 * connector offline with nothing here to bring it back.
 *
 * Anything in `MMS_TARGETS` is MERGED OVER the derived set rather than replacing
 * it. Not every tenant can be derived — an owner who set their own password
 * through an invite leaves no credential in the registry — so replacing would
 * force whoever needs to add one tenant by hand to maintain all of them by hand.
 */
async function buildTargets() {
  const targets = {};
  const rows = await tenantsRepo.listAllTenants();
  const allow = allowed();
  for (const t of rows) {
    // FAIL CLOSED. An unlisted tenant is not reachable, and an EMPTY list means
    // none are — the opposite of the previous rule, where a missing variable
    // exposed every active tenant to whoever held the connector token.
    //
    // That inversion is the point. The old shape put the safe state behind a
    // session-scoped environment variable, so the protection evaporated on the
    // next restart and the exposure came back on its own. A control that
    // reverts when a process bounces is a setting, not a control.
    //
    // Connector-managed tenants are always in: the partner created them through
    // their own token, so they are already theirs. That is what makes
    // onboarding one call instead of two without widening anything.
    if (!tenantAllowed(t, allow)) continue;
    if (t.status !== 'active' || !t.port) continue;
    // The connector's own CMS account wins over the owner's. The owner
    // credential is a fallback for tenants that never got a dedicated one — and
    // is frequently absent entirely, because the hub signs owners in by SSO and
    // they never set a CMS password at all.
    const email = t.connector_email || t.owner_email;
    const enc = t.connector_email ? t.connector_password_enc : t.owner_password_enc;
    if (!email || !enc) continue;
    let secret;
    try {
      secret = decrypt(enc);
    } catch {
      continue; // unreadable credential — skip rather than emit a broken target
    }
    if (!secret) continue;
    targets[t.slug] = { url: `http://127.0.0.1:${t.port}`, email, secret };
  }

  const explicit = process.env.MMS_TARGETS?.trim();
  if (explicit) {
    try {
      Object.assign(targets, JSON.parse(explicit));
    } catch (e) {
      console.log(`${DIM}[connector] MMS_TARGETS is not valid JSON, ignoring it: ${e.message}${RESET}`);
    }
  }
  return JSON.stringify(targets);
}

/**
 * Tenants we were ASKED to expose but could not derive a target for.
 *
 * Scoped to the allowlist: an unlisted tenant having no credential is not a gap,
 * it is the intended state, and reporting it would bury the one line that
 * matters — "you named this one and it is not reachable" — under every tenant on
 * the box.
 */
async function underivableTenants() {
  const rows = await tenantsRepo.listAllTenants();
  const allow = allowed();
  return rows
    .filter((t) => tenantAllowed(t, allow))
    .filter((t) => {
      if (t.status !== 'active' || !t.port) return true;
      return t.connector_email
        ? !t.connector_password_enc
        : !(t.owner_email && t.owner_password_enc);
    })
    .map((t) => t.slug);
}

const mmsTargets = await buildTargets().catch((e) => {
  console.log(`${DIM}[connector] could not build targets from the registry: ${e.message}${RESET}`);
  return '{}';
});
const targetNames = Object.keys(JSON.parse(mmsTargets));
console.log(
  targetNames.length
    ? `${DIM}connector targets: ${targetNames.join(', ')}${RESET}`
    : `${DIM}connector targets: none — the connector will start but every tool will refuse${RESET}`,
);
if (allowed().length === 0) {
  console.log(
    `${DIM}connector: no allowlist. Only sites created THROUGH the connector are reachable.\n` +
      `           To name others, add them to ${ALLOWLIST_FILE}:\n` +
      `           {"allow":["akhil","client-b"]}${RESET}`,
  );
}
const missing = (await underivableTenants().catch(() => [])).filter((s) => !targetNames.includes(s));
if (missing.length) {
  console.log(
    `${DIM}connector: no stored credential for ${missing.join(', ')} — ` +
      `add to MMS_TARGETS by hand to reach ${missing.length > 1 ? 'them' : 'it'}${RESET}`,
  );
}

// The connector refuses to serve without a bearer token, by design — an
// unauthenticated MCP server is reachable by anything that can route to the
// port. Checked here rather than left to the child, because a child that exits
// one second after start scrolls past in a combined log and looks like nothing
// happened at all. That is exactly how the connector sat dead while everything
// else in this script kept running.
const connectorToken = process.env.MMS_CONNECTOR_MCP_TOKEN?.trim();
const connectorReady = Boolean(connectorToken) && connectorToken.length >= 32;
if (!connectorReady) {
  console.log(
    `${DIM}connector: NOT STARTING — ${
      connectorToken ? 'MMS_CONNECTOR_MCP_TOKEN is shorter than 32 characters' : 'MMS_CONNECTOR_MCP_TOKEN is not set'
    }.\n` +
      `           This is the token your MCP client authenticates with, so it must match the one\n` +
      `           the client already holds. To mint a new one (and re-share it):\n` +
      `           bun -e "console.log(crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''))"${RESET}`,
  );
}

// The console runs from its build, not from Astro's dev server. In dev mode the
// browser downloads every module as its own file, which over the funnel — and
// off this network drive — cost seconds per page; the build serves two bundled
// files instead. Set CONSOLE_DEV=1 for hot reloading while editing the console
// (rebuild afterwards with `npm run console:build`).
const consoleEntry = resolve(HERE, 'ui', 'dist', 'server', 'entry.mjs');
const consoleBuilt = existsSync(consoleEntry);
const consoleDev = process.env.CONSOLE_DEV === '1' || !consoleBuilt;

/** Newest change under a console source folder, so a stale build is announced. */
function newestChange(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(full) : statSync(full).mtimeMs);
  }
  return newest;
}
if (consoleBuilt && !consoleDev) {
  try {
    const sources = ['ui/src', 'ui/public'].filter((d) => existsSync(resolve(HERE, d)));
    const newest = Math.max(
      ...sources.map((d) => newestChange(resolve(HERE, d))),
      statSync(resolve(HERE, 'ui', 'astro.config.mjs')).mtimeMs,
    );
    if (newest > statSync(consoleEntry).mtimeMs) {
      console.log(
        `${YELLOW}console: the build is older than the console's source — you are about to serve the previous version.\n` +
          `         Rebuild with: npm run console:build   (from ${HERE})${RESET}`,
      );
    }
  } catch {
    /* the staleness hint is a convenience, never a reason not to start */
  }
}
if (consoleDev && !consoleBuilt) {
  console.log(
    `${DIM}console: no build found — starting Astro's dev server, which is slow to load.\n` +
      `         Build it once with: npm run console:build   (from ${HERE})${RESET}`,
  );
} else if (consoleDev) {
  console.log(`${DIM}console: CONSOLE_DEV=1 — hot reloading, slower page loads.${RESET}`);
}

const services = [
  { label: 'control-plane', color: CYAN,    cmd: 'node control-plane/server.mjs' },
  {
    label: 'console-ui   ',
    color: MAGENTA,
    cmd: consoleDev ? 'npm --prefix ui run dev' : 'npm --prefix ui run start',
    // The built server takes its address from the environment; the dev server
    // takes it from astro.config.mjs. Same address either way.
    env: consoleDev ? {} : { HOST: '127.0.0.1', PORT: '3000' },
  },
  { label: 'board        ', color: YELLOW,  cmd: 'node ../.serve/server.cjs' },
  ...(connectorReady
    ? [{
        label: 'connector    ',
        color: GREEN,
        // Absolute cwd, and the script addressed absolutely too. A relative
        // `../Connector` depends on cmd.exe honouring a working directory on
        // this mapped network drive, which it does not do reliably — the child
        // then starts in the wrong place, finds no `src/main.ts`, and dies
        // without printing anything a piped stdout ever flushes. Every other
        // service here runs from the Operator directory, so this is the only
        // one that ever needed to move.
        cmd: `bun run "${CONNECTOR_DIR}/src/main.ts" serve --port ${CONNECTOR_PORT}`,
        cwd: CONNECTOR_DIR,
        env: { MMS_TARGETS: mmsTargets },
      }]
    : []),
];

console.log(`\n${DIM}Starting SiteAgent dev services...${RESET}\n`);

// A service that exits comes back (R13).
//
// Until now `exit` only printed a line. In a combined log that line scrolls away
// in seconds, and the service stays down until somebody notices and restarts the
// stack by hand — which is a developer round trip, and the kind the milestone
// counts. The Connector is the one that matters most: everything a studio does
// goes through it, and nothing else here notices it is gone.
//
// Backoff rather than immediate respawn, because the common cause of an instant
// exit is bad configuration, and a tight loop turns that into a wall of noise
// that hides the reason. Doubling from 1s to 30s keeps a genuine crash recovered
// quickly while a misconfigured service settles into one line every half minute.
const RESTART_MIN_MS = 1_000;
const RESTART_MAX_MS = 30_000;
/** Long enough that a service which ran this long was working, not crash-looping. */
const HEALTHY_AFTER_MS = 60_000;

let shuttingDown = false;
const procs = [];

function startService({ label, color, cmd, cwd, env }, backoffMs = RESTART_MIN_MS) {
  const prefix = `${color}[${label}]${RESET} `;
  const startedAt = Date.now();
  const proc = spawn(cmd, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...(env ?? {}) },
  });
  procs.push(proc);

  const print = (chunk) =>
    chunk.toString().split('\n').filter(l => l.trim()).forEach(l => process.stdout.write(prefix + l + '\n'));

  proc.stdout.on('data', print);
  proc.stderr.on('data', print);

  proc.on('exit', (code) => {
    const index = procs.indexOf(proc);
    if (index >= 0) procs.splice(index, 1);
    if (shuttingDown) return;

    // A service that stayed up is treated as healthy, so an unrelated crash
    // hours later starts from a short wait rather than the long one it had
    // climbed to during a bad start earlier in the day.
    const ranFor = Date.now() - startedAt;
    const nextBackoff = ranFor >= HEALTHY_AFTER_MS ? RESTART_MIN_MS : Math.min(backoffMs * 2, RESTART_MAX_MS);
    process.stdout.write(
      `${prefix}${YELLOW}exited (${code}) — restarting in ${Math.round(backoffMs / 1000)}s${RESET}\n`,
    );
    setTimeout(() => {
      if (!shuttingDown) startService({ label, color, cmd, cwd, env }, nextBackoff);
    }, backoffMs).unref?.();
  });

  return proc;
}

for (const service of services) startService(service);

process.on('SIGINT', () => {
  shuttingDown = true;
  console.log('\nShutting down all services...');
  procs.forEach(p => { try { p.kill('SIGTERM'); } catch {} });
  process.exit(0);
});
