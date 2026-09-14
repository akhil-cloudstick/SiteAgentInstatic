/**
 * Self-test for the deploy step's root files. Run: `npm run test:deployer`
 *
 * These four files decide whether a client's site is crawlable, and nothing else
 * checks them. `writeRootFiles` runs once per deploy against a real directory,
 * so it is testable without Cloudflare, without a database and without a tenant
 * — which is the whole reason it is worth pinning here rather than discovering
 * a wrong robots.txt on a live domain.
 *
 * The case that matters most is the transition: a site turned back to noindex
 * must stop advertising a sitemap AND stop serving the one it wrote earlier.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bakedUrlPaths, writeRootFiles } from './deploy.mjs';

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

function checkTrue(name, actual) {
  check(name, actual === true, true);
}

// A baked slot: one .html per route, plus a non-page asset and the 404 document.
function makeSlot() {
  const dir = resolve(tmpdir(), `deployer-selftest-${process.pid}-${Math.round(process.uptime() * 1000)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(resolve(dir, 'blog'), { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), '<html></html>');
  writeFileSync(resolve(dir, 'about-us.html'), '<html></html>');
  writeFileSync(resolve(dir, '404.html'), '<html></html>');
  writeFileSync(resolve(dir, 'style.css'), 'body{}');
  writeFileSync(resolve(dir, 'blog', 'two-days.html'), '<html></html>');
  return dir;
}

const read = (dir, name) => (existsSync(resolve(dir, name)) ? readFileSync(resolve(dir, name), 'utf8') : null);

// ---------------------------------------------------------------------------

const dir = makeSlot();

// Route derivation: index -> /, nested keeps its prefix, 404 and assets excluded.
check('bakedUrlPaths maps the slot to routes', bakedUrlPaths(dir), [
  '/',
  '/about-us',
  '/blog/two-days',
]);

// --- noindex (the default) -------------------------------------------------

writeRootFiles(dir, { slug: 'acme', display_name: 'Acme', pages_url: 'https://siteagent-acme.pages.dev' });

checkTrue('noindex robots.txt blocks everything', read(dir, 'robots.txt').includes('User-agent: *\nDisallow: /'));
checkTrue('noindex writes the X-Robots-Tag header block', read(dir, '_headers')?.includes('X-Robots-Tag: noindex, nofollow'));
checkTrue('noindex llms.txt tells crawlers to stay out', read(dir, 'llms.txt')?.includes('Do not index'));
check('noindex writes no sitemap', existsSync(resolve(dir, 'sitemap.xml')), false);
checkTrue('noindex robots.txt advertises no sitemap', !read(dir, 'robots.txt').includes('Sitemap:'));

// --- flipped on ------------------------------------------------------------

writeRootFiles(dir, {
  slug: 'acme', display_name: 'Acme',
  pages_url: 'https://siteagent-acme.pages.dev',
  custom_domain: 'acme.com',
  search_indexing: true,
});

checkTrue('indexable robots.txt allows crawling', read(dir, 'robots.txt').includes('Allow: /'));
checkTrue('indexable robots.txt advertises the sitemap absolutely', read(dir, 'robots.txt').includes('Sitemap: https://acme.com/sitemap.xml'));
// The bare custom_domain host must gain a scheme — a scheme-less Sitemap line is invalid.
checkTrue('sitemap URL is not scheme-less', !read(dir, 'robots.txt').includes('Sitemap: acme.com'));
check('indexable removes the noindex header block', existsSync(resolve(dir, '_headers')), false);

const sitemap = read(dir, 'sitemap.xml');
checkTrue('sitemap lists the homepage', sitemap.includes('<loc>https://acme.com/</loc>'));
checkTrue('sitemap lists a nested route', sitemap.includes('<loc>https://acme.com/blog/two-days</loc>'));
checkTrue('sitemap excludes the 404 document', !sitemap.includes('/404'));
checkTrue('sitemap excludes non-page assets', !sitemap.includes('style.css'));

// --- flipped back off ------------------------------------------------------
// The regression that matters: a site returned to noindex must not keep serving
// the crawl map it published while it was open.

writeRootFiles(dir, { slug: 'acme', display_name: 'Acme', custom_domain: 'acme.com' });

check('turning indexing back off deletes the stale sitemap', existsSync(resolve(dir, 'sitemap.xml')), false);
checkTrue('turning indexing back off restores the noindex header', read(dir, '_headers')?.includes('noindex'));
checkTrue('turning indexing back off restores Disallow', read(dir, 'robots.txt').includes('Disallow: /'));

rmSync(dir, { recursive: true, force: true });

// --- imported root files must survive ---------------------------------------
// An imported site can bring its own robots.txt / sitemap.xml / _headers.
// atlas-infra.pages.dev serves an imported sitemap listing a different domain
// entirely, and an earlier version of this code deleted files like it without
// asking. Publishing must not eat content the tenant imported.

const dir2 = makeSlot();
const IMPORTED_SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://elsewhere.example/</loc></url></urlset>';
const IMPORTED_HEADERS = '/assets/*\n  Cache-Control: max-age=31536000\n';
const IMPORTED_ROBOTS = 'User-agent: *\nAllow: /\nSitemap: https://elsewhere.example/sitemap.xml\n';

writeFileSync(resolve(dir2, 'sitemap.xml'), IMPORTED_SITEMAP);
writeFileSync(resolve(dir2, '_headers'), IMPORTED_HEADERS);
writeFileSync(resolve(dir2, 'robots.txt'), IMPORTED_ROBOTS);

// noindex over an imported set
writeRootFiles(dir2, { slug: 'acme', display_name: 'Acme', pages_url: 'https://siteagent-acme.pages.dev' });

check('noindex leaves an imported sitemap alone', read(dir2, 'sitemap.xml'), IMPORTED_SITEMAP);
checkTrue('noindex keeps the imported header rules', read(dir2, '_headers').includes('Cache-Control: max-age=31536000'));
checkTrue('noindex appends its block to imported headers', read(dir2, '_headers').includes('X-Robots-Tag: noindex, nofollow'));
// The one deliberate exception: a crawler block a leftover file could defeat is
// not a block, so robots.txt is overwritten when indexing is off.
checkTrue('noindex overrides an imported robots.txt (deliberate)', read(dir2, 'robots.txt').includes('Disallow: /'));

// running twice must not stack duplicate header blocks
writeRootFiles(dir2, { slug: 'acme', display_name: 'Acme', pages_url: 'https://siteagent-acme.pages.dev' });
check(
  'a second noindex deploy does not duplicate the header block',
  (read(dir2, '_headers').match(/X-Robots-Tag/g) || []).length,
  1,
);

// flipped on over an imported set
writeRootFiles(dir2, {
  slug: 'acme', display_name: 'Acme', custom_domain: 'acme.com', search_indexing: true,
});

check('indexable still leaves the imported sitemap alone', read(dir2, 'sitemap.xml'), IMPORTED_SITEMAP);
checkTrue('indexable does not advertise a sitemap it did not write', !read(dir2, 'robots.txt').includes('Sitemap:'));
checkTrue('indexable keeps the imported header file', read(dir2, '_headers').includes('Cache-Control: max-age=31536000'));

rmSync(dir2, { recursive: true, force: true });

// An imported llms.txt / robots.txt on an INDEXABLE site is the site's own
// statement and must not be replaced.
const dir3 = makeSlot();
writeFileSync(resolve(dir3, 'llms.txt'), '# theirs\n');
writeFileSync(resolve(dir3, 'robots.txt'), IMPORTED_ROBOTS);
writeRootFiles(dir3, { slug: 'acme', custom_domain: 'acme.com', search_indexing: true });
check('indexable leaves an imported llms.txt alone', read(dir3, 'llms.txt'), '# theirs\n');
check('indexable leaves an imported robots.txt alone', read(dir3, 'robots.txt'), IMPORTED_ROBOTS);
rmSync(dir3, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll deployer root-file checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
