// Who an administrator can reach (R1, AC-A1.2). Pure — no database — so the
// rules are testable on their own (lib/scope.selftest.mjs).
//
// An administrator is scoped to the platform, one Operator, or one Business.
// Every record carries its full address (operator_id, business_id; stamped by
// the schema's triggers), so reaching a record is a comparison against the
// record itself, and a listing is a filter the query names. A scope-less call
// throws: a query that does not name an address returns nothing, never
// everything.

export const LEVELS = Object.freeze(['platform', 'operator', 'business']);
const RANK = { platform: 0, operator: 1, business: 2 };

const idOf = (v) => (v === null || v === undefined || v === '' ? null : String(v));

/** The scope an admin row (or currentAdmin result) carries. */
export function scopeOf(admin) {
  if (!admin || !LEVELS.includes(admin.scope_level ?? admin.level)) {
    throw new Error('no administrator scope');
  }
  const level = admin.scope_level ?? admin.level;
  return Object.freeze({
    level,
    operatorId: level === 'operator' ? idOf(admin.operator_id ?? admin.operatorId) : null,
    businessId: level === 'business' ? idOf(admin.business_id ?? admin.businessId) : null,
  });
}

function assertScope(scope) {
  if (!scope || !LEVELS.includes(scope.level)) throw new Error('no administrator scope');
  if (scope.level === 'operator' && !scope.operatorId) throw new Error('operator scope without an operator');
  if (scope.level === 'business' && !scope.businessId) throw new Error('business scope without a business');
}

export const isPlatform = (scope) => {
  assertScope(scope);
  return scope.level === 'platform';
};

/** Can this scope see and act on the Operator itself? */
export function canReachOperator(scope, operatorId) {
  assertScope(scope);
  if (scope.level === 'platform') return true;
  if (scope.level === 'operator') return idOf(operatorId) !== null && idOf(operatorId) === scope.operatorId;
  return false;
}

/** Can this scope reach the Business ({ id, operator_id })? */
export function canReachBusiness(scope, business) {
  assertScope(scope);
  if (!business) return false;
  if (scope.level === 'platform') return true;
  if (scope.level === 'operator') {
    return idOf(business.operator_id) !== null && idOf(business.operator_id) === scope.operatorId;
  }
  return idOf(business.id) === scope.businessId;
}

/** Can this scope reach a record addressed { business_id, operator_id }? */
export function canReachRecord(scope, record) {
  assertScope(scope);
  if (!record) return false;
  if (scope.level === 'platform') return true;
  if (scope.level === 'operator') {
    return idOf(record.operator_id) !== null && idOf(record.operator_id) === scope.operatorId;
  }
  return idOf(record.business_id) !== null && idOf(record.business_id) === scope.businessId;
}

/**
 * May this scope OPEN a project's work — its design or its content (R5)?
 *
 * Reaching a project and opening it are different questions. The Platform
 * Owner reaches everything, because counts and status across the estate are
 * its job; it opens nothing, because a customer's work is not. Opening is a
 * distinct, logged "acting as" mode, and `actAs` is that grant: the one
 * project it names, for as long as it lasts.
 *
 * Operator and Business administrators are unchanged — R5 constrains the
 * Platform Owner only. Widening act-as to them later (an Operator entering one
 * of its own Businesses, per the platform vision) is a change to this one
 * predicate and to nothing else.
 */
export function canOpenWork(scope, record, actAs = null) {
  if (!canReachRecord(scope, record)) return false;
  if (scope.level !== 'platform') return true;
  return !!actAs && !!record.slug && String(actAs.slug) === String(record.slug);
}

/**
 * A WHERE fragment naming the scope's address, with its parameters appended
 * after `params`. `alias` is the table alias carrying operator_id/business_id.
 */
export function scopeFilter(scope, alias, params = []) {
  assertScope(scope);
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`bad alias: ${alias}`);
  if (scope.level === 'platform') return { sql: 'true', params: [...params] };
  const next = [...params];
  if (scope.level === 'operator') {
    next.push(scope.operatorId);
    return { sql: `${alias}.operator_id = $${next.length}`, params: next };
  }
  next.push(scope.businessId);
  return { sql: `${alias}.business_id = $${next.length}`, params: next };
}

/**
 * May `caller` create an administrator at `target`? Only at or below its own
 * level, and only inside its own reach.
 * `targetBusiness` is the Business row when target.level is 'business'.
 */
export function canGrant(caller, target, targetBusiness = null) {
  assertScope(caller);
  assertScope(target);
  if (RANK[target.level] < RANK[caller.level]) return false;
  if (target.level === 'platform') return caller.level === 'platform';
  if (target.level === 'operator') return canReachOperator(caller, target.operatorId);
  return !!targetBusiness
    && idOf(targetBusiness.id) === target.businessId
    && canReachBusiness(caller, targetBusiness);
}

/** Can `caller` see or disable the administrator row `admin`? */
export function canManageAdmin(caller, admin, adminBusiness = null) {
  const target = scopeOf(admin);
  return canGrant(caller, target, adminBusiness);
}

/** Human label for the console header. */
export function scopeLabel(scope, names = {}) {
  assertScope(scope);
  if (scope.level === 'platform') return 'Platform';
  if (scope.level === 'operator') return `Operator · ${names.operator || scope.operatorId}`;
  return `Business · ${names.business || scope.businessId}`;
}
