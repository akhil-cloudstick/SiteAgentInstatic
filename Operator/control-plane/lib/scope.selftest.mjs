/**
 * Self-test for administrator scope (R1, AC-A1.2).
 * Run: `npm run test:scope` (from Operator/). No database needed.
 *
 * AC-A1.2: a user scoped to one Business is denied, at the server, read and
 * change of a project under another Business, and sees none of its data. The
 * server's decisions all come from these functions, so the matrix below is the
 * acceptance logic itself.
 */
import {
  scopeOf, canReachOperator, canReachBusiness, canReachRecord, scopeFilter, canGrant, isPlatform,
} from './scope.mjs';

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
function throws(name, fn) {
  try { fn(); failures++; console.error(`FAIL  ${name} (did not throw)`); } catch { console.log(`ok    ${name}`); }
}

// The AC-A1.1 shape: Operator 1 owns Businesses 10 and 11; Operator 2 owns 20;
// Business 30 is direct (no Operator). Each Business owns two projects.
const B = {
  b10: { id: 10, operator_id: 1 },
  b11: { id: 11, operator_id: 1 },
  b20: { id: 20, operator_id: 2 },
  b30: { id: 30, operator_id: null },
};
const project = (slug, b) => ({ slug, business_id: b.id, operator_id: b.operator_id });
const P = {
  a1: project('a1', B.b10), a2: project('a2', B.b10),
  c1: project('c1', B.b11), c2: project('c2', B.b11),
  d1: project('d1', B.b20), d2: project('d2', B.b20),
  e1: project('e1', B.b30), e2: project('e2', B.b30),
};

const platform = scopeOf({ scope_level: 'platform' });
const op1 = scopeOf({ scope_level: 'operator', operator_id: 1 });
const biz10 = scopeOf({ scope_level: 'business', business_id: 10 });
const biz30 = scopeOf({ scope_level: 'business', business_id: 30 });

const reachable = (scope) => Object.keys(P).filter((k) => canReachRecord(scope, P[k]));

// --- who reaches which project ----------------------------------------------
check('platform reaches every project', reachable(platform), Object.keys(P));
check('an operator reaches only its own businesses\' projects', reachable(op1), ['a1', 'a2', 'c1', 'c2']);
check('a business reaches only its own projects', reachable(biz10), ['a1', 'a2']);
check('a direct business reaches only its own projects', reachable(biz30), ['e1', 'e2']);
check('a business admin cannot reach a sibling business under the same operator',
  canReachRecord(biz10, P.c1), false);
check('a business admin cannot reach another operator\'s project', canReachRecord(biz10, P.d1), false);
check('an operator cannot reach a direct business', canReachRecord(op1, P.e1), false);
check('a record without an address is reachable only by the platform',
  [canReachRecord(platform, { business_id: null, operator_id: null }),
    canReachRecord(op1, { business_id: null, operator_id: null }),
    canReachRecord(biz10, { business_id: null, operator_id: null })], [true, false, false]);
check('ids compare as strings (pg returns bigint as text)',
  canReachRecord(biz10, { business_id: '10', operator_id: '1' }), true);

// --- businesses and operators --------------------------------------------------
check('an operator reaches its own businesses', [B.b10, B.b11, B.b20, B.b30].map((b) => canReachBusiness(op1, b)), [true, true, false, false]);
check('a business reaches only itself', [B.b10, B.b11].map((b) => canReachBusiness(biz10, b)), [true, false]);
check('an operator reaches only itself', [canReachOperator(op1, 1), canReachOperator(op1, 2)], [true, false]);
check('a business admin reaches no operator', canReachOperator(biz10, 1), false);

// --- the query filter names the address ---------------------------------------
check('platform filter is an explicit true', scopeFilter(platform, 't'), { sql: 'true', params: [] });
check('operator filter names the operator', scopeFilter(op1, 't', ['x']), { sql: 't.operator_id = $2', params: ['x', '1'] });
check('business filter names the business', scopeFilter(biz10, 'a'), { sql: 'a.business_id = $1', params: ['10'] });
throws('a query without a scope throws', () => scopeFilter(null, 't'));
throws('a scope without its id throws', () => scopeFilter({ level: 'business', businessId: null }, 't'));
throws('an injected alias throws', () => scopeFilter(platform, 't; drop table x'));
throws('an unknown level throws', () => scopeOf({ scope_level: 'owner' }));
check('only platform is platform', [isPlatform(platform), isPlatform(op1), isPlatform(biz10)], [true, false, false]);

// --- nobody grants above their own level --------------------------------------
const target = (level, operatorId = null, businessId = null) => ({ level, operatorId, businessId });
check('platform may grant any level', [
  canGrant(platform, target('platform')),
  canGrant(platform, target('operator', '2')),
  canGrant(platform, target('business', null, '30'), B.b30),
], [true, true, true]);
check('an operator may grant its own operator and its businesses', [
  canGrant(op1, target('operator', '1')),
  canGrant(op1, target('business', null, '10'), B.b10),
], [true, true]);
check('an operator may not grant platform, another operator, or a foreign business', [
  canGrant(op1, target('platform')),
  canGrant(op1, target('operator', '2')),
  canGrant(op1, target('business', null, '20'), B.b20),
  canGrant(op1, target('business', null, '30'), B.b30),
], [false, false, false, false]);
check('a business may grant only itself', [
  canGrant(biz10, target('business', null, '10'), B.b10),
  canGrant(biz10, target('business', null, '11'), B.b11),
  canGrant(biz10, target('operator', '1')),
], [true, false, false]);
check('a business grant must name the business row it grants',
  canGrant(platform, target('business', null, '10'), B.b11), false);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall scope checks passed');
process.exit(0);
