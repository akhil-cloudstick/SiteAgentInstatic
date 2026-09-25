/**
 * Self-test for build stamps (R9, and the gap the validator found in it).
 * Run: `npm run test:stamp` (from Operator/). No database, no network.
 *
 * The gap, in one sentence: the live check recognised a page by its <title>,
 * titles do not change between builds, so an upload that silently did not land
 * left the previous site serving and verified perfectly.
 *
 * What this file pins is the property that closes it — a page's stamp follows
 * its bytes — and the three things that property has to survive: being applied
 * twice, a page with nothing to stamp into, and a whole directory tree.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  BUILD_STAMP_NAME,
  buildStampOf,
  revisionOf,
  stampBakedPages,
  stampHtml,
  stripStamp,
} from './stamp.mjs';

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

const page = (title, body) =>
  `<!doctype html>\r\n<html lang="en">\r\n<head>\r\n  <meta charset="UTF-8">\r\n  <title>${title}</title>\r\n</head>\r\n<body>\r\n${body}\r\n</body>\r\n</html>`;

// --- the property the whole thing rests on ----------------------------------------
//
// Same title, different content. This is exactly the pair a title comparison
// cannot tell apart, and it is the pair the deploy check has to tell apart.
const summer = page('Green Kitchen — Home', '<h1>Summer menu</h1>');
const autumn = page('Green Kitchen — Home', '<h1>Autumn menu</h1>');

check('two builds with the same title get different stamps', revisionOf(summer) !== revisionOf(autumn), true);
check('the same bytes always get the same stamp', revisionOf(summer), revisionOf(page('Green Kitchen — Home', '<h1>Summer menu</h1>')));

// --- stamping, and reading the stamp back -----------------------------------------
const stampedSummer = stampHtml(summer);
check('a stamped page carries its own revision', buildStampOf(stampedSummer), revisionOf(summer));
check('an unstamped page carries none', buildStampOf(summer), null);
check('the stamp is named as the verifier expects', stampedSummer.includes(`name="${BUILD_STAMP_NAME}"`), true);

// The charset meta must still be early in the head — it is the one tag whose
// position a browser cares about, so the stamp goes AFTER it, never before.
check('the stamp sits after the charset meta', stampedSummer.indexOf('charset') < stampedSummer.indexOf(BUILD_STAMP_NAME), true);
check('and the page is otherwise untouched', stripStamp(stampedSummer), summer);

// --- applied twice ------------------------------------------------------------------
//
// A rollback re-uploads a bundle that was already stamped when it first went
// out. If stamping were not idempotent the restored bundle would stamp
// differently every time and the rollback could never verify.
check('stamping is idempotent', stampHtml(stampedSummer), stampedSummer);
check('and three times changes nothing further', stampHtml(stampHtml(stampedSummer)), stampedSummer);

// --- a page with nothing to stamp into ----------------------------------------------
//
// Returns null rather than a stamped-looking page. A caller must be able to
// tell "not stamped" from "stamped", because the verifier grades them
// differently — a page that cannot carry a revision cannot be checked by one.
check('a fragment with no head cannot be stamped', stampHtml('<p>just a fragment</p>'), null);
check('a page with a head but no charset still stamps', buildStampOf(stampHtml('<html><head><title>x</title></head><body>y</body></html>')) !== null, true);

// --- a whole upload directory ---------------------------------------------------------
const dir = mkdtempSync(resolve(tmpdir(), 'mms-stamp-'));
writeFileSync(resolve(dir, 'index.html'), summer);
mkdirSync(resolve(dir, 'about'), { recursive: true });
writeFileSync(resolve(dir, 'about', 'index.html'), page('About', '<p>Since 2019</p>'));
mkdirSync(resolve(dir, 'assets'), { recursive: true });
writeFileSync(resolve(dir, 'assets', 'site.css'), 'body{color:red}');
writeFileSync(resolve(dir, 'robots.txt'), 'User-agent: *');

const result = stampBakedPages(dir);
check('every baked page in the tree is stamped', result.stamped, 2);
check('and nothing was left unstamped', result.unstamped, []);
check('the nested page got its own stamp too', buildStampOf(readFileSync(resolve(dir, 'about', 'index.html'), 'utf8')) !== null, true);
check('non-HTML files are left alone', readFileSync(resolve(dir, 'assets', 'site.css'), 'utf8'), 'body{color:red}');

// Run over an already-stamped directory — what a redeploy of the same slot does.
const again = stampBakedPages(dir);
check('re-stamping a stamped directory changes no value', again.stamped, 2);
check('and the home page still reads as the same build', buildStampOf(readFileSync(resolve(dir, 'index.html'), 'utf8')), revisionOf(summer));

rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall build-stamp checks passed');
process.exit(0);
