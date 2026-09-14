/**
 * Self-test for login resolution. Run: `npm run test:login`
 *
 * One person can own more than one site — which happens the moment an agency
 * runs a second client through us, and happened here the day a partner's
 * address was put on both `global-nettech` and `sheeltron`.
 *
 * The old query took `limit 1` with no ordering, so that person's email matched
 * an arbitrary row: not an error, not a wrong password, just the wrong site —
 * and potentially a different one on the next attempt. On a system where each
 * site is a different client's content, silently choosing is the one thing this
 * must never do.
 */
import { resolveLogin } from './tenantUsers.mjs';

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

// --- the ordinary cases -----------------------------------------------------
check('no match is a failed login', resolveLogin([]), null);
check('exactly one match signs in', resolveLogin(['sheeltron']), 'sheeltron');

// --- the case that used to pick silently ------------------------------------
check(
  'two matches ask which, rather than choosing',
  resolveLogin(['sheeltron', 'global-nettech']),
  { ambiguous: ['global-nettech', 'sheeltron'] },
);
check(
  'the ambiguous list is sorted, so the message is stable between attempts',
  resolveLogin(['zeta', 'alpha', 'mid']),
  { ambiguous: ['alpha', 'mid', 'zeta'] },
);
check(
  'three matches are still refused, not narrowed',
  resolveLogin(['a', 'b', 'c']),
  { ambiguous: ['a', 'b', 'c'] },
);

// --- shape, because the caller branches on it -------------------------------
// hub.mjs treats a string as "signed in" and anything else as "ask". A single
// match must therefore be a bare string, never wrapped.
check('a single match is a bare string', typeof resolveLogin(['only']), 'string');
check('an ambiguous result is not a string', typeof resolveLogin(['a', 'b']), 'object');

// The input is not mutated — the caller derived it from a query result.
const input = ['b', 'a'];
resolveLogin(input);
check('the caller\'s array is left alone', input, ['b', 'a']);

console.log(failures === 0 ? '\nAll login checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
