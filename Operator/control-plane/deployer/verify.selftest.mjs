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

globalThis.fetch = realFetch;
rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall live-verification checks passed');
process.exit(0);
