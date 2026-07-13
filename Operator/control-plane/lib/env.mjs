// Loads .env and exposes a typed-ish config object. Node built-ins only.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// repo root = three levels up from Operator/control-plane/lib/ (all abs() paths
// like Instatic/, Operator/tenant-users/ resolve against it).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The operator module dir (Operator/) — .env lives here, next to package.json.
const OPERATOR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load Operator/.env if present (Node >= 20.6 ships process.loadEnvFile).
try {
  const envFile = resolve(OPERATOR, '.env');
  if (typeof process.loadEnvFile === 'function' && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
} catch { /* env file optional */ }

const abs = (p) => resolve(ROOT, p);

function loadEncKey() {
  const fromEnv = (process.env.SETTINGS_ENC_KEY || '').trim();
  if (fromEnv.length >= 64) return Buffer.from(fromEnv.slice(0, 64), 'hex');
  const stateDir = abs('Operator/control-plane/.state');
  const keyFile = resolve(stateDir, 'enc.key');
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
  mkdirSync(stateDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyFile, key.toString('hex'), 'utf8');
  return key;
}

const cpPort = Number(process.env.CONTROL_PLANE_PORT || 4400);
const encKey = loadEncKey();

export const config = {
  root: ROOT,
  adminDatabaseUrl: process.env.ADMIN_DATABASE_URL
    || 'postgres://siteagent_admin:siteagent_admin_pw@127.0.0.1:5432/siteagent_platform',
  pgHost: process.env.PG_HOST || '127.0.0.1',
  pgPort: Number(process.env.PG_PORT || 5432),
  pgDb: process.env.PG_DB || 'siteagent_platform',
  controlPlanePort: cpPort,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${cpPort}`,
  instaticDir: abs(process.env.INSTATIC_DIR || './Instatic'),
  tenantsDir: abs(process.env.TENANTS_DIR || './Operator/tenant-users'),
  tenantBasePort: Number(process.env.TENANT_BASE_PORT || 3101),
  // OpenDesign per-tenant daemons. Each gets its own OD_DATA_DIR + port. The data
  // dir MUST be on LOCAL disk (OpenDesign uses SQLite, which can't run on the SMB
  // share), so it defaults under the OS temp dir — never under tenant-users/ (S:).
  openDesignDir: abs('OpenDesign'),
  // The website build rule OD must follow so tenant pages import into Instatic
  // cleanly. Passed to each Instatic-connected OD daemon as OD_CMS_RULE_FILE;
  // OD reads it live (cached by mtime), so editing this file updates the rule
  // OD enforces with no redeploy. Override the path with CMS_RULE_FILE.
  cmsRuleFile: abs(process.env.CMS_RULE_FILE || './Operator/rules/templateRule.md'),
  odDataBase: process.env.OD_TENANTS_DIR || resolve(tmpdir(), 'siteagent-od'),
  odBasePort: Number(process.env.OD_BASE_PORT || 7500),
  // Per-tenant OpenDesign web (Next.js dev) port range — the tenant browses here;
  // it proxies /api,/artifacts,/frames,/sso to the tenant's daemon (odBasePort).
  odWebBasePort: Number(process.env.OD_WEB_BASE_PORT || 8100),
  // Remote client testing: one tenant editor at a time is published on the spare
  // Tailscale funnel port so a remote client can log in and edit it. The origin
  // must match the public funnel URL exactly (Instatic checks it for CSRF + uses
  // it to decide https/Secure cookies).
  testFunnelPort: Number(process.env.TEST_FUNNEL_PORT || 10000),
  testFunnelOrigin: process.env.TEST_FUNNEL_ORIGIN || 'https://siteagent.tailbbb0d2.ts.net:10000',
  // Single public gateway: ONE Tailscale funnel port fronts the whole flow
  // (operator + every tenant's OpenDesign + Instatic). Funnel allows only
  // 443 / 8443 / 10000; 443 gives the cleanest URL (no port). The control plane
  // reverse-proxies from here to the right per-tenant backend. gatewayOrigin is
  // the browser-facing origin every backend must trust for CSRF + cookies.
  gatewayPort: Number(process.env.GATEWAY_PORT || 443),
  gatewayOrigin: process.env.GATEWAY_ORIGIN || 'https://siteagent.tailbbb0d2.ts.net',
  // The control-plane opens the funnel itself on boot (once listening) and closes
  // it on shutdown, so restart = live. Set GATEWAY_FUNNEL=0 to manage it by hand.
  gatewayFunnelEnabled: process.env.GATEWAY_FUNNEL !== '0',
  // The Astro operator console (proxied under /operator). `astro dev`/`preview`.
  operatorConsolePort: Number(process.env.OPERATOR_CONSOLE_PORT || 3000),
  encKey,
  tokenSecret: (process.env.TOKEN_SECRET || encKey.toString('hex')),
};

export default config;
