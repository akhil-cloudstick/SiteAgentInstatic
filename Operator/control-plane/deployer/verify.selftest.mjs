/**
 * Self-test for live verification (R9, AC-B9.2).
 * Run: `npm run test:verify` (from Operator/). No database, no network.
 *
 * The criterion is specific about what does NOT count:
 *
 *   "verification fetches the deployed site and confirms served content: a
 *    deliberately missing route serving a fallback is caught as a FAIL. An
 *    HTTP-200 check is not sufficient."
 *
 * That sentence exists because a host serving a single-page-app fallback
 * answers 200 for every address, including the ones that are not there. A site
 * with half its pages missing passes a status sweep perfectly. So the test that
 * matters is the one this file spends most of its space on: a site where every
 * route answers 200, and half of them serve somebody else's page.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { verifyDeployedSite, fingerprintOfBakedPage } from './verify.mjs';
import { stampHtml, stripStamp } from './stamp.mjs';

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

const page = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

// A baked site on disk: home, about, contact.
const dir = mkdtempSync(resolve(tmpdir(), 'mms-verify-'));
writeFileSync(resolve(dir, 'index.html'), page('Green Kitchen — Home'));
mkdirSync(resolve(dir, 'about'), { recursive: true });
writeFileSync(resolve(dir, 'about', 'index.html'), page('About Green Kitchen'));
mkdirSync(resolve(dir, 'contact'), { recursive: true });
writeFileSync(resolve(dir, 'contact', 'index.html'), page('Contact Green Kitchen'));
const routes = ['/', '/about/', '/contact/'];

// --- what a page is recognised by -----------------------------------------------
check('a baked page is fingerprinted by its title', fingerprintOfBakedPage(page('Home')), 'Home');
check('a page with no usable title has no fingerprint', fingerprintOfBakedPage('<html><body>hi</body></html>'), null);

// --- the fetching, stubbed --------------------------------------------------------
const realFetch = globalThis.fetch;
const serve = (bodyFor) => {
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    const body = bodyFor(path);
    if (body === null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
};
const noWait = { sleep: async () => {} };

// --- the site really is serving what was baked ------------------------------------
serve((path) => {
  if (path === '/') return page('Green Kitchen — Home');
  if (path === '/about/') return page('About Green Kitchen');
  if (path === '/contact/') return page('Contact Green Kitchen');
  return null;
});
const good = await verifyDeployedSite('https://green.test', dir, routes, noWait);
check('a site serving every baked page verifies', good.verification, 'verified');
check('and says how many routes it checked', good.checked, 3);

// --- THE ONE THAT MATTERS: 200 everywhere, wrong content ---------------------------
//
// Every route answers 200. A status check passes this site completely. Two of
// its three pages are the host's fallback.
serve((path) => (path === '/' ? page('Green Kitchen — Home') : page('Page not found')));
const fallback = await verifyDeployedSite('https://green.test', dir, routes, noWait);
check('a fallback served under a 200 is caught as a failure', fallback.verification, 'failed');
check('and the failing routes are counted', fallback.failed, 2);
check('and the reason names what went wrong', /served something other than its own page/.test(fallback.detail), true);

// --- a route that is simply gone ---------------------------------------------------
serve((path) => (path === '/contact/' ? null : page(path === '/' ? 'Green Kitchen — Home' : 'About Green Kitchen')));
const missing = await verifyDeployedSite('https://green.test', dir, routes, noWait);
check('a missing route fails', missing.verification, 'failed');
check('and is reported by its own address', /\/contact\//.test(missing.detail), true);

// --- could not check is NOT success (R8 meeting R9) --------------------------------
//
// The distinction the whole of R8 is about: a check that could not run reports
// neither pass nor fail, and never gets mistaken for a clean site.
const noAddress = await verifyDeployedSite('', dir, routes, noWait);
check('with no address to fetch, the result is unverified — not verified', noAddress.verification, 'unverified');

const nothingBaked = await verifyDeployedSite('https://green.test', dir, [], noWait);
check('with nothing baked to compare against, the result is unverified', nothingBaked.verification, 'unverified');

globalThis.fetch = async () => {
  throw new Error('the network is down');
};
const unreachable = await verifyDeployedSite('https://green.test', dir, routes, noWait);
check('a site that cannot be reached at all is not reported as verified', unreachable.verification !== 'verified', true);

// --- THE ONE THE VALIDATOR ASKED FOR: same titles, stale content -------------------
//
// An upload silently does not land. The host keeps serving the PREVIOUS build:
// same routes, same titles, older words. Every check in this file above this
// line passes that site. It is the failure a title cannot see, because a title
// is deliberately stable across builds.
//
// The baked pages now carry a stamp derived from their own bytes, so the
// comparison is against what was uploaded rather than what it was called.

const stampedDir = mkdtempSync(resolve(tmpdir(), 'mms-verify-stamped-'));
const build = (title, body) =>
  `<!doctype html><html><head><meta charset="UTF-8"><title>${title}</title></head><body>${body}</body></html>`;

// What was just baked and stamped on disk — the upload being checked.
const homeV2 = stampHtml(build('Green Kitchen — Home', '<h1>Autumn menu</h1>'));
const aboutV2 = stampHtml(build('About Green Kitchen', '<p>Since 2019</p>'));
writeFileSync(resolve(stampedDir, 'index.html'), homeV2);
mkdirSync(resolve(stampedDir, 'about'), { recursive: true });
writeFileSync(resolve(stampedDir, 'about', 'index.html'), aboutV2);
const stampedRoutes = ['/', '/about/'];

// What the host is still serving — the build before it. The about page did not
// change between the two builds; the home page did.
const homeV1 = stampHtml(build('Green Kitchen — Home', '<h1>Summer menu</h1>'));
const aboutV1 = stampHtml(build('About Green Kitchen', '<p>Since 2019</p>'));

check('the stale home page is indistinguishable by title', /<title>Green Kitchen — Home<\/title>/.test(homeV1), true);

serve((path) => (path === '/' ? homeV1 : aboutV1));
const stale = await verifyDeployedSite('https://green.test', stampedDir, stampedRoutes, noWait);
check('a stale site with identical titles is CAUGHT by the build stamp', stale.verification, 'failed');
check('and the reason names the build that is actually being served', /served build [0-9a-f]{12}, not the [0-9a-f]{12} that was uploaded/.test(stale.detail), true);

// The documented limit, pinned so it is a decision and not a surprise: a page
// whose bytes did not change between the two builds has the same stamp in both,
// so it matches. That is the right answer — the bytes being served ARE the bytes
// that were meant to be served. What is detected is a stale SITE, never merely a
// stale upload of an identical site.
check('a page that did not change between builds still matches', stale.failed, 1);

// --- and the site that really is serving the upload --------------------------------
serve((path) => (path === '/' ? homeV2 : aboutV2));
const fresh = await verifyDeployedSite('https://green.test', stampedDir, stampedRoutes, noWait);
check('the site serving what was uploaded verifies', fresh.verification, 'verified');
check('and the verdict records that it was checked the strong way', /\(by build stamp\)/.test(fresh.detail), true);

// --- a host that serves the right content with the stamp removed --------------------
//
// Cannot be told apart from an older build, so it is not passed. P2: a check
// that cannot run reports failure, and the message names both causes rather
// than asserting the one it cannot distinguish.
serve((path) => stripStamp(path === '/' ? homeV2 : aboutV2));
const unstamped = await verifyDeployedSite('https://green.test', stampedDir, stampedRoutes, noWait);
check('a served page with no stamp at all is not passed', unstamped.verification, 'failed');
check('and says it cannot tell an old build from a stripped tag', /no build stamp/.test(unstamped.detail), true);

// --- pages baked before stamping existed still verify, and say so -------------------
//
// The fallback has to keep working, but it must not read as the same result.
serve((path) => (path === '/' ? page('Green Kitchen — Home') : page('About Green Kitchen')));
const byTitle = await verifyDeployedSite('https://green.test', dir, ['/', '/about/'], noWait);
check('an unstamped bundle still verifies by title', byTitle.verification, 'verified');
check('but the verdict does NOT claim the strong check', /by title only/.test(byTitle.detail), true);

rmSync(stampedDir, { recursive: true, force: true });

// --- ITEM 3: a small site is checked completely, not sampled ----------------------
//
// It used to sample at most twelve routes whatever the size of the site, so a
// partial upload that missed a route outside the sample passed. Sheeltron is
// eighteen routes.

const manyDir = mkdtempSync(resolve(tmpdir(), 'mms-verify-many-'));
const manyRoutes = [];
for (let i = 0; i < 18; i++) {
  const route = i === 0 ? '/' : `/page-${i}/`;
  const file = i === 0 ? resolve(manyDir, 'index.html') : resolve(manyDir, `page-${i}`, 'index.html');
  if (i > 0) mkdirSync(resolve(manyDir, `page-${i}`), { recursive: true });
  writeFileSync(file, page(`Page ${i} — Green Kitchen`));
  manyRoutes.push(route);
}

let fetched = 0;
const countingServe = (bodyFor) => {
  globalThis.fetch = async (url) => {
    const p = new URL(String(url)).pathname;
    fetched++;
    const body = bodyFor(p);
    if (body === null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
};

// Every route serves its own page except ONE, deep in the list — the route a
// twelve-route sample would most likely skip.
countingServe((p) => {
  if (p === '/page-17/') return page('Page not found');
  const i = p === '/' ? 0 : Number(/page-(\d+)/.exec(p)?.[1] ?? -1);
  return i >= 0 ? page(`Page ${i} — Green Kitchen`) : null;
});
fetched = 0;
const deep = await verifyDeployedSite('https://green.test', manyDir, manyRoutes, noWait);
check('an 18-route site is checked completely', deep.checked, 18);
check('so a wrong page in the 18th route is caught', deep.verification, 'failed');
// The failing verdict counts against the full 18, which is the proof it did
// not stop at twelve.
check('and the verdict counts the failure against all 18', /of 18 routes wrong/.test(deep.detail), true);

rmSync(manyDir, { recursive: true, force: true });

// --- ITEM 4: pages that share a title cannot be told apart -------------------------
//
// A brand-only title, or a templated blog title, repeats across the build. A
// host serving the wrong page still contains the expected string, so the title
// comparison passes it. These pages carry no stamp, so there is nothing else to
// compare — and that has to be reported, not waved through.

const sharedDir = mkdtempSync(resolve(tmpdir(), 'mms-verify-shared-'));
writeFileSync(resolve(sharedDir, 'index.html'), page('Green Kitchen'));
mkdirSync(resolve(sharedDir, 'menu'), { recursive: true });
writeFileSync(resolve(sharedDir, 'menu', 'index.html'), page('Green Kitchen'));
mkdirSync(resolve(sharedDir, 'contact'), { recursive: true });
writeFileSync(resolve(sharedDir, 'contact', 'index.html'), page('Contact Green Kitchen'));
const sharedRoutes = ['/', '/menu/', '/contact/'];

// The host serves the HOME page for /menu/ — a real fallback. The old title
// check passed this, because both pages are called "Green Kitchen".
serve((p) => (p === '/contact/' ? page('Contact Green Kitchen') : page('Green Kitchen')));
const shared = await verifyDeployedSite('https://green.test', sharedDir, sharedRoutes, noWait);
check('a route whose title is not unique is not compared by it', shared.checked, 1);
check('and the verdict says so rather than staying silent', /could not be told apart/.test(shared.detail), true);
check('the route that IS unique still verifies', shared.verification, 'verified');

// And when NOTHING can be told apart, the answer is "could not check" — never a
// pass. This is P2: a check that cannot run reports failure, not success.
const allSameDir = mkdtempSync(resolve(tmpdir(), 'mms-verify-allsame-'));
writeFileSync(resolve(allSameDir, 'index.html'), page('Green Kitchen'));
mkdirSync(resolve(allSameDir, 'menu'), { recursive: true });
writeFileSync(resolve(allSameDir, 'menu', 'index.html'), page('Green Kitchen'));
serve(() => page('Green Kitchen'));
const allSame = await verifyDeployedSite('https://green.test', allSameDir, ['/', '/menu/'], noWait);
check('a build where every title repeats is unverified, not verified', allSame.verification, 'unverified');
check('and it says to publish again to stamp them', /build stamp/.test(allSame.detail), true);

rmSync(sharedDir, { recursive: true, force: true });
rmSync(allSameDir, { recursive: true, force: true });

globalThis.fetch = realFetch;
rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall live-verification checks passed');
process.exit(0);
