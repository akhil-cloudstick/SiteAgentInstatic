/**
 * Self-test for a project's people. Run: `npm run test:login` (from Operator/).
 *
 * Two rules live here, both decided without a database:
 *
 * 1. Sign-in never picks a project. One person can belong to several projects —
 *    the moment an agency runs a second client through us — and silently
 *    choosing one put people on an arbitrary client's content. Several matches
 *    mean "ask" (the project chooser).
 *
 * 2. Inviting a second person ADDS an account (NEW-2). Before Phase 1 a project
 *    held one login and a new invite overwrote it — and a re-invite of someone
 *    who already had a password locked them out.
 */
import { resolveLogin, planInvite, ROLES, INVITABLE_ROLES, ROLE_LABELS } from './tenantUsers.mjs';

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

const person = (id, tenant_slug, role = 'admin') => ({ id, tenant_slug, role });

// --- resolveLogin: never pick ----------------------------------------------------
check('no match is a failed login', resolveLogin([]), null);
check('exactly one match signs that person in', resolveLogin([person(1, 'sheeltron')]), person(1, 'sheeltron'));
check(
  'two matches ask which, rather than choosing',
  resolveLogin([person(2, 'sheeltron'), person(1, 'global-nettech')]),
  { choose: [person(1, 'global-nettech'), person(2, 'sheeltron')] },
);
check(
  'the choice is sorted by project, so the chooser is stable between attempts',
  resolveLogin([person(3, 'zeta'), person(1, 'alpha'), person(2, 'mid')]).choose.map((p) => p.tenant_slug),
  ['alpha', 'mid', 'zeta'],
);
const input = [person(2, 'b'), person(1, 'a')];
resolveLogin(input);
check("the caller's array is left alone", input.map((p) => p.tenant_slug), ['b', 'a']);

// --- planInvite: NEW-2 ------------------------------------------------------------
const row = (id, email, role, status) => ({ id, email, role, status });
const project = [row(1, 'owner@acme.test', 'owner', 'active'), row(2, 'a@acme.test', 'admin', 'active')];

check('a second person is added, not written over the first',
  planInvite(project, 'b@acme.test', 'client'), { action: 'insert' });
check('the same check is case- and space-insensitive for existing people',
  planInvite(project, '  A@ACME.test ', 'client').action, 'refuse');
check('an active person is never re-invited (that used to lock them out)',
  planInvite(project, 'a@acme.test', 'admin'),
  { action: 'refuse', reason: 'That person already has access to this project' });
check('someone still invited gets a new link, not a second account',
  planInvite([...project, row(3, 'c@acme.test', 'member', 'invited')], 'c@acme.test', 'client'),
  { action: 'reissue', id: 3 });
check('a removed person can be invited again as a new account',
  planInvite([...project, row(4, 'gone@acme.test', 'client', 'removed')], 'gone@acme.test', 'client'),
  { action: 'insert' });
check('a second owner is refused',
  planInvite(project, 'boss@acme.test', 'owner'),
  { action: 'refuse', reason: 'This project already has an owner' });
check('the first owner of a new project is added',
  planInvite([], 'owner@new.test', 'owner'), { action: 'insert' });
check('an owner with no email on record is re-issued, not duplicated',
  planInvite([row(9, null, 'owner', 'invited')], null, 'owner'), { action: 'reissue', id: 9 });
check('an invited owner is not turned into another role by a re-invite',
  planInvite([row(9, 'o@x.test', 'owner', 'invited')], 'o@x.test', 'client').action, 'refuse');
check('a non-owner needs an email', planInvite(project, '', 'client').action, 'refuse');
check('an email must look like one', planInvite(project, 'not-an-email', 'client').action, 'refuse');
check('an unknown role is refused', planInvite(project, 'x@acme.test', 'superuser').action, 'refuse');

// --- the role vocabulary is the CMS's own four --------------------------------------
check('roles are the CMS roles', ROLES, ['owner', 'admin', 'client', 'member']);
check('an administrator invites only non-owner roles', INVITABLE_ROLES, ['admin', 'client', 'member']);
check('the console labels match the PRD (publisher / author)',
  [ROLE_LABELS.admin, ROLE_LABELS.client], ['Publisher', 'Author']);

console.log(failures === 0 ? '\nAll login checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
