/**
 * Which tenants the connector may reach.
 *
 * Extracted from `dev.mjs` so it can be tested. This decides whether an
 * external partner's agent can see a given client's site, which is not a rule
 * that should only ever be exercised by starting the whole stack and reading a
 * log line.
 *
 * Two sources, unioned:
 *
 *   - `Operator/connector-targets.json` — the durable one. The environment
 *     variable it replaces only ever lived in the shell that set it, so the
 *     next terminal started without it and the connector silently went back to
 *     exposing every active tenant. A control that reverts when a process
 *     bounces is a setting, not a control.
 *   - `MMS_CONNECTOR_TENANTS` — still honoured, so nothing that depends on it
 *     breaks, and so a one-off can be added without editing a file.
 *
 * Absent or empty means NO tenants beyond the connector-managed ones. That
 * inversion is the point: the previous rule treated an empty list as "no filter
 * configured" and allowed everything, so the failure mode of forgetting was
 * maximum exposure. For a token that can create sites, replace a site's whole
 * contents and publish, forgetting should cost reachability, not safety.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `Operator/connector-targets.json`, next to the dev script that reads it. */
export const ALLOWLIST_FILE = resolve(HERE, '..', '..', 'connector-targets.json');

/**
 * @param {{ file?: string, env?: string, onWarn?: (msg: string) => void }} [options]
 * @returns {string[]} tenant slugs, de-duplicated
 */
export function allowedSlugs(options = {}) {
  const file = options.file ?? ALLOWLIST_FILE;
  const env = options.env ?? process.env.MMS_CONNECTOR_TENANTS ?? '';
  const warn = options.onWarn ?? (() => {});

  const fromEnv = env.split(',').map((s) => s.trim()).filter(Boolean);

  let fromFile = [];
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed?.allow)) {
        fromFile = parsed.allow.map((s) => String(s).trim()).filter(Boolean);
      }
    }
  } catch (e) {
    // Loud, and still fail-closed. A typo must not widen the set back to
    // everything — that is exactly the direction this rule exists to prevent.
    warn(`${file} is not readable JSON (${e.message}); ignoring it`);
  }

  return [...new Set([...fromFile, ...fromEnv])];
}

/**
 * Whether one tenant row may be exposed to the connector.
 *
 * Connector-managed tenants are always in: the partner created them through
 * their own token, so they are already theirs. That is what lets onboarding be
 * a single call without widening anything — a site we create ourselves stays
 * invisible however many are added.
 *
 * @param {{ slug: string, connector_managed?: boolean }} tenant
 * @param {string[]} allow
 */
export function tenantAllowed(tenant, allow) {
  return tenant.connector_managed === true || allow.includes(tenant.slug);
}
