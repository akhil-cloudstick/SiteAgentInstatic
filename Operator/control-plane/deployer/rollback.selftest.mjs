/**
 * Self-test for rollback and the known-good ring (security item E10).
 * Run: `npm run test:rollback` (from Operator/). No database, no network, no Cloudflare.
 *
 * WHY THIS EXISTS
 * ---------------
 * R9 retained bundles and wrote receipts, and NOTHING could read either back:
 * `listKnownGood` and `listReceipts` had zero callers repo-wide. So "failed
 * deployment and rollback exercised" had no mechanism to exercise.
 *
 * Two rules are pinned here, and both were wrong in the shipped code:
 *
 *  1. A bundle that FAILED verification was still filed as known-good.
 *     `retainKnownGood` ran unconditionally, above the line that computed
 *     whether the site was live. With three generations kept, three bad deploys
 *     evicted every good one — the ring a rollback reads from could be emptied
 *     by exactly the failure a rollback exists to recover from.
 *
 *  2. `unverified` is not `verified`. It means the check could not run, and
 *     keeping a bundle on that basis is the fail-open principle P2 forbids.
 *
 * The full `rollbackTenant` needs a database, Cloudflare credentials and a real
 * wrangler, so the decisions it makes are extracted as pure functions and tested
 * here rather than mocked into something that proves less than it appears to.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { shouldRetainBundle, selectKnownGood } from './deploy.mjs';
import { retainKnownGood, listKnownGood } from './receipt.mjs';

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

// ---------------------------------------------------------------------------
// 1. What qualifies as known-good
// ---------------------------------------------------------------------------

check('a verified bundle is retained', shouldRetainBundle('verified'), true);
check('THE BUG: a failed bundle is NOT retained', shouldRetainBundle('failed'), false);
check('P2: an unverified bundle is NOT retained', shouldRetainBundle('unverified'), false);
check('an unknown verdict is not retained', shouldRetainBundle(undefined), false);

// ---------------------------------------------------------------------------
// 2. Which generation a rollback targets
// ---------------------------------------------------------------------------

const ring = [
  { at: '2026-03-03', path: '/kept/2026-03-03' },
  { at: '2026-02-02', path: '/kept/2026-02-02' },
  { at: '2026-01-01', path: '/kept/2026-01-01' },
];

check('no target given picks the newest', selectKnownGood(ring).target.at, '2026-03-03');
check('a named target is honoured', selectKnownGood(ring, '2026-02-02').target.at, '2026-02-02');
check('an empty ring refuses', selectKnownGood([]).ok, false);
check('an empty ring says why', /nothing known-good/.test(selectKnownGood([]).reason), true);

// The important one: no silent substitution. A rollback that quietly restored a
// different generation than the one asked for is worse than refusing.
check('an unknown target refuses rather than defaulting', selectKnownGood(ring, '1999-01-01').ok, false);
check(
  'the refusal lists what IS available',
  /2026-03-03/.test(selectKnownGood(ring, '1999-01-01').reason),
  true,
);

// ---------------------------------------------------------------------------
// 3. The ring itself — real filesystem, no mocks
// ---------------------------------------------------------------------------

const root = mkdtempSync(resolve(tmpdir(), 'rollback-selftest-'));

// `retainKnownGood` resolves its destination through `tenantPaths(slug)`, which
// is the REAL data directory — there is no override hook, and inventing an env
// var it does not read would leave the ring under `tenant-users/` after every
// run. So this uses a dedicated throwaway slug that exists for no other purpose
// and deletes that project's directory in the `finally` below. Only the source
// bundles live in tmp.
const { tenantPaths } = await import('../runtime/tenantRuntime.mjs');
const SLUG = 'zz-rollback-selftest-throwaway';
const realProjectDir = resolve(tenantPaths(SLUG).uploads, '..');

// Build four distinct bundles and retain them in order.
function bundle(name) {
  const dir = resolve(root, `src-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), `<html>${name}</html>`);
  return dir;
}

try {
  const kept = [];
  for (const name of ['one', 'two', 'three', 'four']) {
    // Timestamped directory names are the ring's ordering, and they are
    // second-resolution — retaining four inside one second would collide, so
    // each retain is given its own moment.
    const at = await retainKnownGood(SLUG, bundle(name));
    kept.push(at);
    await new Promise((r) => setTimeout(r, 1100));
  }

  const live = await listKnownGood(SLUG);
  check('the ring keeps exactly KEEP_GENERATIONS', live.length, 3);
  check('the oldest was evicted', existsSync(kept[0]), false);
  check('the newest three survive', live.map((g) => existsSync(g.path)), [true, true, true]);
  check('newest first', live[0].at > live[live.length - 1].at, true);

  // A rollback copies the chosen bundle rather than moving or mutating it — the
  // retained directory is evidence and has to survive being rolled back to.
  const target = selectKnownGood(live, live[1].at).target;
  const staging = resolve(root, 'staging');
  rmSync(staging, { recursive: true, force: true });
  const { cpSync } = await import('node:fs');
  cpSync(target.path, staging, { recursive: true });
  writeFileSync(resolve(staging, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

  check('the staged copy has the bundle content', existsSync(resolve(staging, 'index.html')), true);
  check('the retained bundle still exists after staging', existsSync(target.path), true);
  check(
    'writing root files into staging does NOT touch the retained bundle',
    existsSync(resolve(target.path, 'robots.txt')),
    false,
  );
  check(
    'and the retained bundle keeps exactly its original files',
    readdirSync(target.path).sort(),
    ['index.html'],
  );
} finally {
  rmSync(root, { recursive: true, force: true });
  // The throwaway project this test retained into. Removed whether or not the
  // checks passed, so a failing run does not leave a ring behind.
  rmSync(realProjectDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll rollback / known-good checks passed.');
