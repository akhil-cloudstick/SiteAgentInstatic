/**
 * Self-test for the Cloudflare Pages ceiling.
 * Run: `npm run test:ceiling` (from Operator/). No database, no network.
 *
 * What is being pinned is the difference between a limit that REFUSES and one
 * that is merely documented. The old behaviour was the second kind: the account
 * filled up, `initTenantSite` failed inside the provisioning saga, the failure
 * was swallowed as non-fatal, and the operator got a project marked `active`
 * with no live site and an explanation buried in a modal.
 *
 * So the cases that matter are the boundaries — and the one where a project
 * consumes no Pages slot at all and must not be refused by a limit it cannot
 * reach.
 */
import {
  PAGES_PROJECT_CEILING,
  PAGES_PROJECT_WARN_AT,
  pagesCeilingNotice,
  tierUsesPagesSlot,
} from './pagesCeiling.mjs';

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

const level = (n) => pagesCeilingNotice(n)?.level ?? null;

// --- the boundaries ---------------------------------------------------------
check('well under the limit says nothing at all', pagesCeilingNotice(12), null);
check('one below the warning threshold is still silent', level(PAGES_PROJECT_WARN_AT - 1), null);
check('the warning threshold warns', level(PAGES_PROJECT_WARN_AT), 'warn');
check('one below the ceiling still only warns', level(PAGES_PROJECT_CEILING - 1), 'warn');

// The important boundary: AT the limit, not past it. The account cannot take
// another, so the next create is the one that would fail.
check('at the ceiling it refuses', level(PAGES_PROJECT_CEILING), 'full');
check('past the ceiling it refuses', level(PAGES_PROJECT_CEILING + 40), 'full');

// --- what the operator is actually told --------------------------------------
//
// The message has to name the number, the limit, and what to do — a refusal that
// only says "limit reached" leaves somebody guessing whether to delete a project
// or add an account.
const full = pagesCeilingNotice(PAGES_PROJECT_CEILING);
check('the refusal names the count', full.message.includes(String(PAGES_PROJECT_CEILING)), true);
check('and says a new project would never get a live site', /never get a live site/.test(full.message), true);
check('and names both ways out', /Remove a project/.test(full.message) && /second Cloudflare account/.test(full.message), true);
check('the refusal carries the count for the caller', full.count, PAGES_PROJECT_CEILING);

const warn = pagesCeilingNotice(PAGES_PROJECT_WARN_AT);
check('the warning says where the wall is', warn.message.includes(String(PAGES_PROJECT_CEILING)), true);
check('and is NOT a refusal', warn.level === 'full', false);

// --- a tier that consumes no slot --------------------------------------------
//
// Lite projects get no Pages project. Refusing one because the account is full
// would block work that cannot possibly be affected by the limit.
check('advanced consumes a Pages slot', tierUsesPagesSlot('advanced'), true);
check('lite does not', tierUsesPagesSlot('lite'), false);

// The trap: an ABSENT tier means advanced, exactly as the provisioner
// normalises it. Testing the raw value would let the commonest case through
// unchecked, which would make the whole guard decorative.
check('an absent tier counts as advanced', tierUsesPagesSlot(undefined), true);
check('an empty tier counts as advanced', tierUsesPagesSlot(''), true);
check('an unknown tier counts as advanced', tierUsesPagesSlot('enterprise'), true);

// --- nonsense in, nothing out -------------------------------------------------
check('a non-numeric count says nothing rather than refusing', pagesCeilingNotice('lots'), null);
check('a negative count says nothing', pagesCeilingNotice(-1), null);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall Pages-ceiling checks passed');
process.exit(0);
