/**
 * Self-test for one project, one domain (R4, AC-A2.3).
 * Run: `npm run test:domains` (from Operator/). No database needed.
 *
 * AC-A2.3: publish to project A only, then fetch both domains — the change
 * appears on A's domain and not on B's.
 *
 * The way that failed was not in the deploy code. `cf_project` and
 * `custom_domain` were free text with nothing stopping two projects from
 * naming the same one, and the deploy path never re-checks that a Cloudflare
 * project belongs to the project being deployed. Two rows pointing at one
 * destination is the whole of the bug, so this file checks the rule that
 * refuses them — as SQL text and as source, because the rest needs a database
 * and this has to run anywhere.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, '../registry/schema.sql'), 'utf8');
const provision = readFileSync(resolve(here, '../provisioner/provision.mjs'), 'utf8');
const odRuntime = readFileSync(resolve(here, '../runtime/odRuntime.mjs'), 'utf8');

// --- the database refuses two projects one destination -------------------------
const cfIndex = /create unique index if not exists tenants_cf_project_unique[\s\S]*?;/.exec(schema)?.[0] ?? '';
const domIndex = /create unique index if not exists tenants_custom_domain_unique[\s\S]*?;/.exec(schema)?.[0] ?? '';

check('a unique index guards the Cloudflare project', cfIndex.length > 0, true);
check('a unique index guards the custom domain', domIndex.length > 0, true);
check('the Cloudflare project is unique only among live projects',
  /where cf_project is not null and status <> 'removed'/.test(cfIndex), true);
check('a removed project does not keep a domain hostage',
  /status <> 'removed'/.test(domIndex), true);
// Domains are case-insensitive in the world; two rows differing only in case
// are the same destination, and the index has to say so.
check('domains compare without case', /lower\(custom_domain\)/.test(domIndex), true);

// --- and the code refuses it first, by name ------------------------------------
check('a collision is checked before a project is created',
  provision.indexOf("assertDomainFree('cf_project'") < provision.indexOf('await tenants.createTenant('), true);
check('both the Cloudflare project and the domain are checked on create',
  /await assertDomainFree\('cf_project'[\s\S]{0,200}await assertDomainFree\('custom_domain'/.test(provision), true);
check('editing a project checks them too',
  (provision.match(/assertDomainFree\(/g) || []).length >= 5, true);
check('the refusal names the project already holding it',
  /is already the \$\{what\} of \$\{taken\.display_name \|\| taken\.slug\}/.test(provision), true);
check('a project may keep its own value (it excludes itself)',
  /slug <> \$2/.test(provision), true);

// --- the design studio stops being a second publisher --------------------------
//
// Upstream defaults the studio's machine state to ~/.open-design, which every
// daemon on this host shares — one Cloudflare token, able to attach any domain
// in that account, with no reference to the registry at all.
check('each project keeps its own studio state', /OD_USER_STATE_DIR/.test(odRuntime), true);
check('the studio state lives under the project data directory',
  /OD_USER_STATE_DIR: resolve\(p\.dataDir/.test(odRuntime), true);

// A lite project used to set nothing, and OD_INSTATIC_URL is not
// credential-shaped, so childEnv passed an inherited one straight through: a
// stray value in the control plane's environment became that daemon's CMS.
check('the CMS destination is always stated, never inherited',
  /OD_INSTATIC_URL: tenant\.instaticUrl \|\| ''/.test(odRuntime), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall domain checks passed');
process.exit(0);
