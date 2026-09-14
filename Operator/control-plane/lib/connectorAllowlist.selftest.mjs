/**
 * Self-test for the connector allowlist. Run: `npm run test:allowlist`
 *
 * This decides whether an external partner's agent can see a given client's
 * site. The previous rule failed OPEN — a missing environment variable meant
 * "no filter configured", so forgetting it exposed every active tenant to
 * whoever held the connector token, and the variable was session-scoped so
 * forgetting was the default outcome of any restart. It is now inverted, and an
 * inversion is exactly the kind of change that deserves a test rather than a
 * log line read once on a good day.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { allowedSlugs, tenantAllowed } from './connectorAllowlist.mjs';

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const dir = mkdtempSync(resolve(tmpdir(), 'allowlist-selftest-'));
const file = resolve(dir, 'connector-targets.json');
const missing = resolve(dir, 'does-not-exist.json');

function writeAllow(value) {
  writeFileSync(file, JSON.stringify(value));
  return file;
}

try {
  // --- the file is the durable source ------------------------------------
  writeAllow({ allow: ['akhil', 'client-b'] });
  check('file entries are read', allowedSlugs({ file, env: '' }), ['akhil', 'client-b']);

  // --- FAIL CLOSED --------------------------------------------------------
  check('a missing file allows nothing', allowedSlugs({ file: missing, env: '' }), []);
  writeAllow({ allow: [] });
  check('an empty list allows nothing', allowedSlugs({ file, env: '' }), []);
  writeAllow({});
  check('a file with no allow key allows nothing', allowedSlugs({ file, env: '' }), []);

  // A typo must not widen the set back to everything — that is the exact
  // direction this rule exists to prevent.
  writeFileSync(file, '{ this is not json');
  let warned = '';
  check('unreadable JSON allows nothing', allowedSlugs({ file, env: '', onWarn: (m) => { warned = m; } }), []);
  check('unreadable JSON warns rather than passing silently', warned.includes('not readable JSON'), true);

  // --- the environment variable still works, and merges -------------------
  writeAllow({ allow: ['akhil'] });
  check('env adds to the file', allowedSlugs({ file, env: 'client-b' }), ['akhil', 'client-b']);
  check('env alone still works', allowedSlugs({ file: missing, env: 'akhil,client-b' }), ['akhil', 'client-b']);
  check('duplicates collapse', allowedSlugs({ file, env: 'akhil' }), ['akhil']);
  check('whitespace and empties are ignored', allowedSlugs({ file: missing, env: ' akhil , , client-b ' }), ['akhil', 'client-b']);

  // --- per-tenant decision ------------------------------------------------
  const allow = ['akhil', 'client-b'];
  check('a listed tenant is allowed', tenantAllowed({ slug: 'akhil' }, allow), true);
  check('an unlisted tenant is refused', tenantAllowed({ slug: 'someone-else' }, allow), false);

  // Connector-created sites are theirs already: this is what makes onboarding
  // one call rather than two, without widening anything.
  check(
    'a connector-managed tenant is allowed without being listed',
    tenantAllowed({ slug: 'sheeltron', connector_managed: true }, allow),
    true,
  );
  check(
    'a connector-managed tenant is allowed even with an empty list',
    tenantAllowed({ slug: 'sheeltron', connector_managed: true }, []),
    true,
  );
  // The flag must be the boolean true, not any truthy value a driver might
  // hand back for a column that does not exist yet.
  check(
    'a tenant we created is NOT exposed by the managed rule',
    tenantAllowed({ slug: 'internal-scratch', connector_managed: false }, allow),
    false,
  );
  check(
    'an absent flag is treated as not managed',
    tenantAllowed({ slug: 'internal-scratch' }, allow),
    false,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll allowlist checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
