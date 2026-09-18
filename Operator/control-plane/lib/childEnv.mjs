// The environment a project process (CMS, Design daemon, Design web) starts
// with.
//
// Spawning with `...process.env` handed every project the control plane's own
// secrets: the admin database URL (every project's schema), the settings
// encryption key (every stored credential — and the signing master when
// TOKEN_SECRET is unset), the connector token. A project process runs AI agents
// and third-party plugins; anything it can read, a prompt injection can read.
// Cross-business isolation (R1, AC-A1.2) is only real if a project holds
// nothing that reaches past its own project.
//
// So: inherit the machine's ordinary variables (PATH, SystemRoot, TEMP, …),
// drop anything credential-shaped, then add exactly what the project needs.

const DENY_EXACT = new Set([
  'ADMIN_DATABASE_URL',
  'DATABASE_URL',
  'SETTINGS_ENC_KEY',
  'TOKEN_SECRET',
  'MMS_CONNECTOR_MCP_TOKEN',
  'MMS_TARGETS',
  'PGPASSWORD',
  'PG_PASSWORD',
]);

// Anything named like a credential, whatever the product prefix.
const DENY_PATTERN = /(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|ENC_?KEY|CREDENTIAL|DATABASE_URL|_DSN$)/i;

export function isInheritable(name) {
  return !DENY_EXACT.has(name) && !DENY_PATTERN.test(name);
}

/** The inherited base, filtered, with `extra` (the project's own values) on top. */
export function childEnv(extra = {}, base = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && isInheritable(k)) out[k] = v;
  }
  return { ...out, ...extra };
}
